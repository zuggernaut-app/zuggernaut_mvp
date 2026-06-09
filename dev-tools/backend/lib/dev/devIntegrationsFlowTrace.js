'use strict';

const { mongoose } = require('../../shared');
const { assertBusinessAccess } = require('../../../../backend/api/v1/lib/assertBusinessAccess');
const { backendRequire } = require('../../shared');
const axios = backendRequire('axios');
const {
  buildGoogleConnectUrl,
  verifyOAuthState,
  getOAuthRedirectUri,
  completeGoogleOAuthCallback,
} = require('../../../../backend/services/integrations/googleOAuthService');
const { encryptToken, decryptToken } = require('../../../../backend/lib/crypto/tokenEncryption');
const { getFreshGoogleAccessToken } = require('../../../../backend/services/integrations/googleTokenService');
const { listAccessibleCustomers } = require('../../../../backend/services/integrations/googleAdsAccountClient');
const { getConnectionStatus } = require('../../../../backend/services/capabilities/integrationConnectionService');
const { discoverProviderConnection } = require('../../../../backend/services/integrations/providerDiscoveryService');
const { getGoogleAdsApiVersion } = require('../../../../backend/services/integrations/googleAdsApiConfig');
const {
  allScopesForProvider,
  getGoogleProviderOAuthConfig,
} = require('../../../../backend/constants/googleOAuth');
const {
  runProviderSmokeTest,
  getDiagnosticsOverview,
  ensureSandboxBusiness,
} = require('../../services/dev/integrationDiagnosticsService');
const { getTemporalClient } = require('../../../../backend/lib/temporalClient');
const { SETUP_RUN_WORKFLOW_NAME, SCRAPE_WORKFLOW_NAME } = require('../../../../backend/constants/temporalDefaults');

const BusinessContext = mongoose.model('BusinessContext');
const IntegrationConnection = mongoose.model('IntegrationConnection');

const TRACEABLE_PROVIDERS = ['google_ads', 'gtm', 'gbp'];
const DEFAULT_PROVIDER = 'google_ads';
const DEV_RETURN_PATH = '/dev/integrations';

/**
 * @param {string} [provider]
 * @returns {'google_ads' | 'gtm' | 'gbp'}
 */
function normalizeProvider(provider) {
  const value = (provider || DEFAULT_PROVIDER).trim();
  if (!TRACEABLE_PROVIDERS.includes(value)) {
    throw new Error(`Unsupported provider: ${value}. Use one of: ${TRACEABLE_PROVIDERS.join(', ')}`);
  }
  return value;
}

/**
 * @param {'google_ads' | 'gtm' | 'gbp'} provider
 */
function getProviderTraceConfig(provider) {
  const cfg = getGoogleProviderOAuthConfig(provider);
  const requiredScopeFragment =
    provider === 'google_ads' ? 'adwords' : provider === 'gtm' ? 'tagmanager' : 'business.manage';

  return {
    provider,
    displayName: cfg?.displayName ?? provider,
    requiredScopeFragment,
    connectEndpoint: `GET /dev/integrations/google/${provider}/connect-url`,
    smokeEndpoint: `POST /dev/integrations/${provider}/smoke-test`,
    frontendConnectCall: `fetchDevGoogleConnectUrl("${provider}", businessId)`,
    frontendSmokeCall: `runProviderSmokeTest("${provider}", businessId)`,
    smokeService:
      provider === 'google_ads' ? 'runGoogleAdsDiagnostics' : 'discoverProviderConnection',
    storedPipelineLabel:
      provider === 'google_ads'
        ? 'Token refresh + listAccessibleCustomers'
        : 'Token refresh + discoverProviderConnection',
    storedPipelinePath:
      provider === 'google_ads' ? 'debugGoogleAdsListCustomers.js Mode B' : 'runProviderSmokeTest',
  };
}

/** @typedef {'ok' | 'oauth_not_completed' | 'callback_failed' | 'callback_never_reached_backend' | 'wrong_business' | 'success_redirect_but_no_row' | 'tokens_missing' | 'stale_discovery'} OAuthPersistenceVerdict */

const CALLBACK_REASONS_BEFORE_PERSIST = new Set([
  'invalid_state',
  'missing_code',
  'invalid_business',
  'forbidden',
  'access_denied',
  'interaction_required',
  'login_required',
]);

const CALLBACK_REASONS_DURING_PERSIST = new Set([
  'OAUTH_TOKEN_EXCHANGE_FAILED',
  'INSUFFICIENT_SCOPES',
  'UNSUPPORTED_PROVIDER',
  'callback_failed',
]);

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   ok: boolean,
 *   skipped?: boolean,
 *   detail?: string,
 *   data?: Record<string, unknown>,
 *   hint?: string,
 * }} FlowStageResult
 */

/**
 * @param {string} label
 * @param {boolean} ok
 * @param {Partial<FlowStageResult>} [extra]
 * @returns {FlowStageResult}
 */
function stageResult(label, ok, extra = {}) {
  return {
    id: extra.id ?? label.toLowerCase().replace(/\s+/g, '_'),
    label,
    ok,
    ...extra,
  };
}

function isTruthyMock(value) {
  return value === 'true' || value === '1';
}

/**
 * @param {'google_ads' | 'gtm' | 'gbp'} provider
 * @param {Record<string, string | undefined>} env
 */
function traceEnvironment(provider, env = process.env) {
  const traceCfg = getProviderTraceConfig(provider);
  const googleAdsApiVersion = env.GOOGLE_ADS_API_VERSION?.trim() || getGoogleAdsApiVersion();
  const issues = [];
  const warnings = [];

  if (!env.GOOGLE_CLIENT_ID?.trim()) issues.push('GOOGLE_CLIENT_ID missing');
  if (!env.GOOGLE_CLIENT_SECRET?.trim()) issues.push('GOOGLE_CLIENT_SECRET missing');
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) issues.push('JWT_SECRET missing or too short');
  if (!env.TOKEN_ENCRYPTION_KEY?.trim()) issues.push('TOKEN_ENCRYPTION_KEY missing');

  if (provider === 'google_ads') {
    if (env.GOOGLE_ADS_API_ENABLED !== 'true') issues.push('GOOGLE_ADS_API_ENABLED is not true');
    if (!env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim()) issues.push('GOOGLE_ADS_DEVELOPER_TOKEN missing');
    if (googleAdsApiVersion.includes('.1')) {
      issues.push(`GOOGLE_ADS_API_VERSION=${googleAdsApiVersion} is invalid (use v24 not v24.1)`);
    }
  }

  if (provider === 'gtm' && env.GTM_API_ENABLED !== 'true' && !isTruthyMock(env.GTM_API_MOCK)) {
    warnings.push('GTM_API_ENABLED is not true (discovery/smoke may fail without mock)');
  }
  if (provider === 'gbp' && env.GBP_API_ENABLED !== 'true' && !isTruthyMock(env.GBP_API_MOCK)) {
    warnings.push('GBP_API_ENABLED is not true (discovery/smoke may fail without mock)');
  }

  const mocks = {
    googleOAuthMock: isTruthyMock(env.GOOGLE_OAUTH_MOCK),
    googleAdsApiMock: isTruthyMock(env.GOOGLE_ADS_API_MOCK),
    gtmApiMock: isTruthyMock(env.GTM_API_MOCK),
    gbpApiMock: isTruthyMock(env.GBP_API_MOCK),
  };

  const detailParts = [];
  if (issues.length) detailParts.push(issues.join('; '));
  if (warnings.length) detailParts.push(`warnings: ${warnings.join('; ')}`);
  if (!detailParts.length) detailParts.push('Required env vars present');

  return stageResult(`Environment (${traceCfg.displayName})`, issues.length === 0, {
    id: 'environment',
    detail: detailParts.join(' | '),
    data: {
      provider,
      googleAdsApiVersion: provider === 'google_ads' ? googleAdsApiVersion : null,
      googleAdsApiEnabled: env.GOOGLE_ADS_API_ENABLED === 'true',
      gtmApiEnabled: env.GTM_API_ENABLED === 'true',
      gbpApiEnabled: env.GBP_API_ENABLED === 'true',
      googleAdsLoginCustomerId: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim() || null,
      oauthRedirectUri: getOAuthRedirectUri(),
      requiredScopes: allScopesForProvider(provider),
      ...mocks,
      warnings,
    },
    hint:
      issues.length > 0
        ? 'Fix env and restart the backend process before re-running OAuth or smoke test.'
        : warnings.length > 0
          ? 'OAuth may work; live API discovery needs API_ENABLED=true or mock mode.'
          : undefined,
  });
}

/**
 * @param {string} businessId
 */
async function traceBusinessContext(businessId) {
  if (!mongoose.Types.ObjectId.isValid(businessId)) {
    return stageResult('Business context', false, {
      id: 'business_context',
      detail: `Invalid businessId: ${businessId}`,
      hint: 'Copy businessId from Dev Integrations page after sandbox loads.',
    });
  }

  const bc = await BusinessContext.findOne({ businessId }).lean();
  if (!bc) {
    return stageResult('Business context', false, {
      id: 'business_context',
      detail: `No BusinessContext for businessId ${businessId}`,
      hint: 'POST /dev/integrations/sandbox-business or open Dev Integrations to create sandbox.',
    });
  }

  return stageResult('Business context', true, {
    id: 'business_context',
    data: {
      businessId: bc.businessId.toString(),
      userId: bc.userId.toString(),
      businessName: bc.businessName,
      confirmedAt: bc.confirmedAt ?? null,
    },
  });
}

/**
 * Mirrors GET /dev/integrations/google/:provider/connect-url (frontend fetchDevGoogleConnectUrl).
 * @param {'google_ads' | 'gtm' | 'gbp'} provider
 * @param {string} businessId
 * @param {string} userId
 */
async function traceFrontendConnectUrl(provider, businessId, userId) {
  const traceCfg = getProviderTraceConfig(provider);
  const access = await assertBusinessAccess(userId, businessId);
  if (!access) {
    return stageResult('Frontend connect URL', false, {
      id: 'frontend_connect_url',
      detail: 'assertBusinessAccess failed — user does not own this businessId',
      hint: 'Connect OAuth on the same sandbox businessId shown on the page.',
    });
  }

  try {
    const url = buildGoogleConnectUrl({
      businessId: access.businessId.toString(),
      provider,
      userId,
      returnPath: DEV_RETURN_PATH,
    });

    const parsed = new URL(url);
    const state = parsed.searchParams.get('state') || '';
    const scope = parsed.searchParams.get('scope') || '';
    const redirectUri = parsed.searchParams.get('redirect_uri') || '';
    const clientId = parsed.searchParams.get('client_id') || '';

    const scopeOk = scope.includes(traceCfg.requiredScopeFragment);
    const redirectOk = redirectUri === getOAuthRedirectUri();
    const stateOk = Boolean(state);
    const clientOk = Boolean(clientId);

    const ok = scopeOk && redirectOk && stateOk && clientOk;

    return stageResult('Frontend connect URL', ok, {
      id: 'frontend_connect_url',
      detail: ok
        ? 'buildGoogleConnectUrl produced a valid Google authorize URL'
        : [
            !scopeOk && `missing ${traceCfg.requiredScopeFragment} scope`,
            !redirectOk && `redirect_uri mismatch (got ${redirectUri})`,
            !stateOk && 'missing state',
            !clientOk && 'missing client_id',
          ]
            .filter(Boolean)
            .join('; '),
      data: {
        endpoint: traceCfg.connectEndpoint,
        frontendCall: traceCfg.frontendConnectCall,
        authorizeHost: parsed.origin,
        redirectUri,
        scopeIncludesRequired: scopeOk,
        requiredScopeFragment: traceCfg.requiredScopeFragment,
        stateLength: state.length,
      },
      hint: ok
        ? 'Open the Connect URL printed at the end of this report (same as Dev Integrations Connect OAuth button).'
        : 'Fix OAuth client config or GOOGLE_OAUTH_REDIRECT_URI / API_PUBLIC_BASE_URL.',
      _connectUrl: url,
      _state: state,
    });
  } catch (err) {
    return stageResult('Frontend connect URL', false, {
      id: 'frontend_connect_url',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Mirrors GET /api/v1/integrations/google/callback state handling (before token exchange).
 * @param {'google_ads' | 'gtm' | 'gbp'} provider
 * @param {string} state
 * @param {string} businessId
 * @param {string} userId
 */
async function traceOAuthCallbackParsing(provider, state, businessId, userId) {
  if (!state) {
    return stageResult('OAuth callback parsing', false, {
      id: 'oauth_callback_parsing',
      detail: 'No OAuth state available (run connect URL stage first)',
      skipped: true,
    });
  }

  const payload = verifyOAuthState(state);
  if (!payload) {
    return stageResult('OAuth callback parsing', false, {
      id: 'oauth_callback_parsing',
      detail: 'verifyOAuthState returned null — invalid or expired JWT state',
      hint: 'Generate a fresh connect URL; state TTL is 10 minutes.',
    });
  }

  const businessMatch = payload.businessId === businessId;
  const providerMatch = payload.provider === provider;
  const userMatch = payload.userId === userId;
  const returnPathOk = payload.returnPath === DEV_RETURN_PATH;

  const access = await assertBusinessAccess(payload.userId, payload.businessId);
  const accessOk = Boolean(access);

  const ok = businessMatch && providerMatch && userMatch && accessOk;

  return stageResult('OAuth callback parsing', ok, {
    id: 'oauth_callback_parsing',
    detail: ok
      ? 'State JWT verifies; callback would accept code for this business/user'
      : [
          !businessMatch && `state businessId ${payload.businessId} != ${businessId}`,
          !providerMatch && `state provider ${payload.provider} != ${provider}`,
          !userMatch && `state userId ${payload.userId} != ${userId}`,
          !accessOk && 'assertBusinessAccess failed for state payload',
        ]
          .filter(Boolean)
          .join('; '),
    data: {
      endpoint: 'GET /api/v1/integrations/google/callback?code=...&state=...',
      backendHandler: 'completeGoogleOAuthCallback (after verifyOAuthState)',
      returnPath: payload.returnPath ?? null,
      returnPathMatchesDevPage: returnPathOk,
      temporalWorkflowStartedOnCallback: false,
    },
    hint:
      'This stage does not exchange a code. Complete OAuth in the browser, or set OAUTH_CODE to run token exchange.',
  });
}

/**
 * Proves TOKEN_ENCRYPTION_KEY works (completeGoogleOAuthCallback depends on this).
 */
function traceTokenCryptoPipeline() {
  try {
    const sample = 'trace-crypto-probe';
    const encrypted = encryptToken(sample);
    const decrypted = decryptToken(encrypted);
    const ok = decrypted === sample;
    return stageResult('Token crypto pipeline', ok, {
      id: 'token_crypto_pipeline',
      detail: ok
        ? 'encryptToken/decryptToken round-trip succeeded'
        : 'Decrypt did not match plaintext',
      data: {
        service: 'completeGoogleOAuthCallback → encryptToken',
        ciphertextLength: encrypted.length,
      },
      hint: ok ? undefined : 'Fix TOKEN_ENCRYPTION_KEY in backend/.env and restart the server.',
    });
  } catch (err) {
    return stageResult('Token crypto pipeline', false, {
      id: 'token_crypto_pipeline',
      detail: err instanceof Error ? err.message : String(err),
      hint: 'completeGoogleOAuthCallback will fail before Mongo save if encryption throws.',
    });
  }
}

/**
 * Optional HTTP probe: backend callback route responds (does not prove Google redirect succeeded).
 */
async function traceCallbackRouteReachability() {
  const base = (process.env.API_PUBLIC_BASE_URL?.trim() || 'http://localhost:3000').replace(
    /\/+$/,
    '',
  );
  const callbackUrl = `${base}/api/v1/integrations/google/callback`;

  try {
    const res = await axios.get(callbackUrl, {
      maxRedirects: 0,
      validateStatus: (status) => status >= 300 && status < 400,
      timeout: 8000,
    });
    const location = res.headers.location || '';
    const reachedBackend = res.status === 302 && location.includes('integration=');
    return stageResult('Callback route reachability', reachedBackend, {
      id: 'callback_route_reachability',
      detail: reachedBackend
        ? `GET ${callbackUrl} returned 302 to frontend (${location.slice(0, 120)}...)`
        : `Unexpected response status=${res.status}`,
      data: {
        callbackUrl,
        status: res.status,
        redirectLocation: location || null,
        note: 'A 302 with integration=error&reason=invalid_state is expected with no query params.',
      },
      hint: reachedBackend
        ? 'Backend callback route is reachable. OAuth must still complete in the browser.'
        : 'Start the backend API or fix API_PUBLIC_BASE_URL.',
    });
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : null;
    return stageResult('Callback route reachability', false, {
      id: 'callback_route_reachability',
      detail:
        code === 'ECONNREFUSED'
          ? `Cannot reach ${callbackUrl} (connection refused)`
          : err instanceof Error
            ? err.message
            : String(err),
      hint: 'Run the backend (npm start) on the host/port in API_PUBLIC_BASE_URL.',
    });
  }
}

/**
 * Replays completeGoogleOAuthCallback with a one-time OAuth code (same as callback handler).
 * @param {'google_ads' | 'gtm' | 'gbp'} provider
 * @param {string} businessId
 * @param {string} userId
 * @param {string} oauthCode
 */
async function traceOAuthCallbackReplay(provider, businessId, userId, oauthCode) {
  const access = await assertBusinessAccess(userId, businessId);
  if (!access) {
    return stageResult('OAuth callback replay', false, {
      id: 'oauth_callback_replay',
      detail: 'assertBusinessAccess failed',
    });
  }

  try {
    const result = await completeGoogleOAuthCallback({
      businessId: access.businessId.toString(),
      provider,
      userId,
      code: oauthCode,
    });

    const conn = await IntegrationConnection.findOne({ businessId, provider })
      .select('+accessTokenEnc +refreshTokenEnc')
      .lean();

    const saved = Boolean(conn?.accessTokenEnc);

    return stageResult('OAuth callback replay', saved, {
      id: 'oauth_callback_replay',
      detail: saved
        ? `completeGoogleOAuthCallback succeeded; connectionHealth=${result.connectionHealth}`
        : 'completeGoogleOAuthCallback returned but no accessTokenEnc in Mongo',
      data: {
        service: 'completeGoogleOAuthCallback',
        connectionHealth: result.connectionHealth,
        discoveryReason: result.discoveryReason ?? null,
        scopesCount: result.scopes?.length ?? 0,
        hasRefreshToken: Boolean(conn?.refreshTokenEnc),
        providerIdentifiers: conn?.providerIdentifiers ?? null,
      },
      hint: saved
        ? 'Tokens are saved. Re-run trace without --oauth-code to verify later stages.'
        : 'Internal failure after callback — see detail above.',
    });
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : 'CALLBACK_REPLAY_FAILED';
    return stageResult('OAuth callback replay', false, {
      id: 'oauth_callback_replay',
      detail: `${code}: ${err instanceof Error ? err.message : String(err)}`,
      data: {
        service: 'completeGoogleOAuthCallback',
        failurePhase: CALLBACK_REASONS_DURING_PERSIST.has(code)
          ? 'during_token_exchange_or_persist'
          : 'unknown',
        errorCode: code,
      },
      hint:
        code === 'OAUTH_TOKEN_EXCHANGE_FAILED'
          ? 'Code may be expired (one-time), redirect_uri mismatch, or wrong GOOGLE_CLIENT_SECRET.'
          : code === 'INSUFFICIENT_SCOPES'
            ? `Google did not grant required scopes for ${provider}.`
            : 'Paste a fresh code immediately after OAuth redirect using --oauth-code.',
    });
  }
}

/**
 * Interprets Mongo state + optional frontend redirect params to answer:
 * was callback called? did it fail? saved on wrong business?
 * @param {'google_ads' | 'gtm' | 'gbp'} provider
 * @param {string} businessId
 * @param {string} userId
 * @param {{ oauthOutcome?: string, oauthReason?: string }} [options]
 */
async function traceOAuthPersistenceDiagnosis(provider, businessId, userId, options = {}) {
  const connHere = await IntegrationConnection.findOne({ businessId, provider })
    .select('+accessTokenEnc +refreshTokenEnc')
    .lean();

  const userBusinesses = await BusinessContext.find({
    userId: new mongoose.Types.ObjectId(userId),
  })
    .select('businessId businessName')
    .lean();

  const businessIds = userBusinesses.map((b) => b.businessId);
  const otherConns = await IntegrationConnection.find({
    businessId: { $in: businessIds },
    provider,
  })
    .select('businessId connectionHealth updatedAt createdAt +accessTokenEnc')
    .lean();

  const connOnOtherBusiness = otherConns.filter(
    (c) => c.businessId.toString() !== businessId && c.accessTokenEnc,
  );

  const oauthOutcome = options.oauthOutcome?.trim() || null;
  const oauthReason = options.oauthReason?.trim() || null;

  /** @type {OAuthPersistenceVerdict} */
  let verdict = 'oauth_not_completed';
  let completeGoogleOAuthCallbackLikelyCalled = false;
  const hints = [];

  if (connHere?.accessTokenEnc) {
    const discoveryError = connHere.providerIdentifiers?.discoveryError ?? null;
    verdict = discoveryError ? 'stale_discovery' : 'ok';
    completeGoogleOAuthCallbackLikelyCalled = true;
    if (discoveryError) {
      hints.push('Tokens are saved; discoveryError is stale — run smoke test to refresh.');
    }
  } else if (connHere && !connHere.accessTokenEnc) {
    verdict = 'tokens_missing';
    completeGoogleOAuthCallbackLikelyCalled = true;
    hints.push('IntegrationConnection row exists without access token — partial or corrupted save.');
  } else if (connOnOtherBusiness.length > 0) {
    verdict = 'wrong_business';
    completeGoogleOAuthCallbackLikelyCalled = true;
    const other = connOnOtherBusiness[0];
    const otherName =
      userBusinesses.find((b) => b.businessId.toString() === other.businessId.toString())
        ?.businessName ?? 'unknown';
    hints.push(
      `OAuth saved on businessId ${other.businessId} (${otherName}), not ${businessId}. Use that businessId or reconnect here.`,
    );
  } else if (oauthOutcome === 'connected') {
    verdict = 'success_redirect_but_no_row';
    completeGoogleOAuthCallbackLikelyCalled = true;
    hints.push(
      'Frontend saw integration=connected but Mongo has no row — check a different database URI than the running API.',
    );
  } else if (oauthOutcome === 'error' && oauthReason) {
    if (CALLBACK_REASONS_BEFORE_PERSIST.has(oauthReason)) {
      verdict = 'callback_never_reached_backend';
      completeGoogleOAuthCallbackLikelyCalled = false;
      hints.push(
        `Callback stopped before completeGoogleOAuthCallback (reason=${oauthReason}). Tokens were never exchanged.`,
      );
    } else if (CALLBACK_REASONS_DURING_PERSIST.has(oauthReason)) {
      verdict = 'callback_failed';
      completeGoogleOAuthCallbackLikelyCalled = true;
      hints.push(
        `completeGoogleOAuthCallback was invoked but failed (reason=${oauthReason}). Nothing was saved.`,
      );
    } else {
      verdict = 'callback_failed';
      completeGoogleOAuthCallbackLikelyCalled = true;
      hints.push(`OAuth returned integration=error&reason=${oauthReason}.`);
    }
  } else {
    verdict = 'oauth_not_completed';
    completeGoogleOAuthCallbackLikelyCalled = false;
    hints.push(
      'No tokens in Mongo for this businessId. Complete Connect OAuth in the browser, then re-run trace.',
    );
    hints.push(
      'After redirect, copy integration/provider/reason from the page URL and pass --oauth-outcome and --oauth-reason.',
    );
  }

  const ok = verdict === 'ok' || verdict === 'stale_discovery';

  return stageResult('OAuth persistence diagnosis', ok, {
    id: 'oauth_persistence_diagnosis',
    detail: [
      `verdict=${verdict}`,
      `completeGoogleOAuthCallbackLikelyCalled=${completeGoogleOAuthCallbackLikelyCalled}`,
      connHere
        ? `rowExists=true hasAccessToken=${Boolean(connHere.accessTokenEnc)}`
        : 'rowExists=false',
      connOnOtherBusiness.length > 0
        ? `otherBusinessesWithTokens=${connOnOtherBusiness.map((c) => c.businessId.toString()).join(', ')}`
        : null,
      oauthOutcome ? `frontendOutcome=${oauthOutcome}` : null,
      oauthReason ? `frontendReason=${oauthReason}` : null,
    ]
      .filter(Boolean)
      .join('; '),
    data: {
      verdict,
      completeGoogleOAuthCallbackLikelyCalled,
      tokensSavedForThisBusiness: Boolean(connHere?.accessTokenEnc),
      connectionOnOtherBusinesses: connOnOtherBusiness.map((c) => ({
        businessId: c.businessId.toString(),
        connectionHealth: c.connectionHealth,
        updatedAt: c.updatedAt,
      })),
      frontendRedirectParams: oauthOutcome
        ? { integration: oauthOutcome, provider, reason: oauthReason }
        : null,
      howToCaptureRedirectParams: `After OAuth, browser lands on /dev/integrations?integration=connected|error&provider=${provider}&reason=...`,
    },
    hint: hints.join(' '),
  });
}

/**
 * If tokens exist, exercises the same path as smoke test (refresh + live discovery).
 * @param {'google_ads' | 'gtm' | 'gbp'} provider
 * @param {string} businessId
 */
async function traceStoredTokenPipeline(provider, businessId) {
  const traceCfg = getProviderTraceConfig(provider);
  const conn = await IntegrationConnection.findOne({ businessId, provider })
    .select('+accessTokenEnc +refreshTokenEnc')
    .lean();

  if (!conn?.accessTokenEnc) {
    return stageResult('Stored token pipeline', false, {
      id: 'stored_token_pipeline',
      detail: 'Skipped — no stored access token for this businessId',
      skipped: true,
    });
  }

  const steps = [];

  try {
    const accessToken = await getFreshGoogleAccessToken({ businessId, provider });
    steps.push({ step: 'getFreshGoogleAccessToken', ok: true });

    if (provider === 'google_ads') {
      const customerIds = await listAccessibleCustomers(accessToken);
      steps.push({
        step: 'listAccessibleCustomers',
        ok: true,
        customerCount: customerIds.length,
        customerIds: customerIds.slice(0, 5),
      });

      return stageResult('Stored token pipeline', true, {
        id: 'stored_token_pipeline',
        detail: `${traceCfg.storedPipelineLabel} OK (${customerIds.length} customers)`,
        data: {
          samePathAs: traceCfg.storedPipelinePath,
          steps,
          apiVersion: getGoogleAdsApiVersion(),
        },
      });
    }

    const discovery = await discoverProviderConnection(provider, accessToken);
    steps.push({
      step: 'discoverProviderConnection',
      ok: true,
      connectionHealth: discovery.connectionHealth,
      discoveryReason: discovery.reason ?? null,
      providerIdentifiers: discovery.providerIdentifiers ?? null,
    });

    return stageResult('Stored token pipeline', true, {
      id: 'stored_token_pipeline',
      detail: `${traceCfg.storedPipelineLabel} OK (health=${discovery.connectionHealth})`,
      data: {
        samePathAs: traceCfg.storedPipelinePath,
        steps,
      },
    });
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : 'TOKEN_PIPELINE_FAILED';
    const failStep =
      steps.length === 0
        ? 'getFreshGoogleAccessToken'
        : provider === 'google_ads'
          ? 'listAccessibleCustomers'
          : 'discoverProviderConnection';
    steps.push({
      step: failStep,
      ok: false,
      errorCode: code,
      message: err instanceof Error ? err.message : String(err),
    });

    return stageResult('Stored token pipeline', false, {
      id: 'stored_token_pipeline',
      detail: `${code}: ${err instanceof Error ? err.message : String(err)}`,
      data: { steps },
      hint:
        'Tokens are in Mongo but Google API call failed — env/API enabled flag or API permissions issue, not OAuth save issue.',
    });
  }
}

/**
 * What the callback persists — IntegrationConnection row after OAuth (or before if reconnecting).
 * @param {'google_ads' | 'gtm' | 'gbp'} provider
 * @param {string} businessId
 */
async function tracePostOAuthPersistence(provider, businessId) {
  const conn = await IntegrationConnection.findOne({ businessId, provider })
    .select('+accessTokenEnc +refreshTokenEnc')
    .lean();

  if (!conn) {
    return stageResult('Post-OAuth persistence', false, {
      id: 'post_oauth_persistence',
      detail: `No IntegrationConnection document for this businessId + ${provider}`,
      data: {
        mongoQuery: { businessId, provider },
      },
      hint: 'Click Connect OAuth on Dev Integrations for THIS businessId, then re-run trace.',
    });
  }

  const hasAccess = Boolean(conn.accessTokenEnc);
  const hasRefresh = Boolean(conn.refreshTokenEnc);
  const discoveryError = conn.providerIdentifiers?.discoveryError ?? null;
  const customerIds = conn.providerIdentifiers?.customerIds ?? null;

  const status = await getConnectionStatus(businessId, provider, { attemptRefresh: true });

  const ok = hasAccess && status.reason !== 'missing_connection';

  return stageResult('Post-OAuth persistence', ok, {
    id: 'post_oauth_persistence',
    detail: ok
      ? `Connection stored; health=${conn.connectionHealth}; ready=${status.ready}`
      : `Connection incomplete: hasAccess=${hasAccess}, status.reason=${status.reason}`,
    data: {
      connectionHealth: conn.connectionHealth,
      discoveryReason: conn.providerIdentifiers?.discoveryReason ?? null,
      discoveryError,
      customerIds,
      scopesGranted: status.scopesGranted ?? [],
      scopesMissing: status.scopesMissing ?? [],
      tokenExpiryAt: conn.tokenExpiryAt ?? null,
      hasRefreshToken: hasRefresh,
      connectionStatus: {
        ready: status.ready,
        reason: status.reason,
        nextAction: status.nextAction ?? null,
      },
    },
    hint: discoveryError
      ? 'Stale discoveryError in Mongo — run smoke test after fixing API version to refresh.'
      : undefined,
  });
}

/**
 * Mirrors POST /dev/integrations/:provider/smoke-test (frontend runProviderSmokeTest).
 * @param {'google_ads' | 'gtm' | 'gbp'} provider
 * @param {string} businessId
 */
async function traceSmokeTest(provider, businessId) {
  const traceCfg = getProviderTraceConfig(provider);
  const result = await runProviderSmokeTest(businessId, provider);

  return stageResult('Smoke test', result.ok === true, {
    id: 'smoke_test',
    detail: result.ok
      ? 'runProviderSmokeTest succeeded'
      : `${result.errorCode ?? 'FAILED'}: ${result.message ?? 'unknown'}`,
    data: {
      endpoint: traceCfg.smokeEndpoint,
      frontendCall: traceCfg.frontendSmokeCall,
      startedAt: result.startedAt,
      apiVersion: result.apiVersion ?? null,
      connectionHealth: result.connectionHealth ?? null,
      discoveryReason: result.discoveryReason ?? null,
      providerIdentifiers: result.providerIdentifiers ?? null,
      tests: result.tests ?? null,
      errorCode: result.errorCode ?? null,
    },
    hint:
      result.errorCode === 'MISSING_CONNECTION'
        ? 'Connect OAuth on the same businessId before smoke test.'
        : result.errorCode === 'ADS_PROVISIONING_REQUIRED' ||
            result.discoveryReason === 'GTM_PROVISIONING_REQUIRED'
          ? 'Discovery works; provisioning approval may still be required for setup runs.'
          : result.connectionHealth === 'selection_required'
            ? 'OAuth and discovery succeeded; pick a Google Ads customer or GTM container before mutations.'
            : undefined,
  });
}

/**
 * Mirrors GET /dev/integrations/overview (page load).
 * @param {'google_ads' | 'gtm' | 'gbp'} provider
 * @param {string} businessId
 */
async function traceOverview(provider, businessId) {
  const overview = await getDiagnosticsOverview(businessId);
  const connection = overview.connections?.[provider];

  const staleError = connection?.providerIdentifiers?.discoveryError ?? null;
  const ok =
    connection?.ready === true ||
    connection?.connectionHealth === 'provisioning_required' ||
    connection?.connectionHealth === 'selection_required';

  return stageResult('Diagnostics overview', ok, {
    id: 'diagnostics_overview',
    detail: ok
      ? `Overview shows ${provider} ready=${connection.ready}, health=${connection.connectionHealth}`
      : `Overview not ready: reason=${connection?.reason}, health=${connection?.connectionHealth}, discoveryError=${staleError}`,
    data: {
      endpoint: 'GET /dev/integrations/overview?businessId=...',
      frontendCall: 'fetchDiagnosticsOverview(businessId)',
      connection: connection ?? null,
      environment: overview.environment,
    },
    hint: staleError && !ok ? 'Overview reads Mongo; successful smoke test should clear discoveryError.' : undefined,
  });
}

/**
 * Clarifies Temporal boundaries: OAuth does not start setupRunWorkflow; setup-runs and scrape do.
 * @param {'google_ads' | 'gtm' | 'gbp'} provider
 * @param {{ probeTemporal?: boolean }} [options]
 */
async function traceTemporalBoundary(provider, options = {}) {
  const traceCfg = getProviderTraceConfig(provider);
  const oauthStartsWorkflow = false;
  const smokeStartsWorkflow = false;
  const setupRunStartsWorkflow = true;
  const scrapeStartsWorkflow = true;

  let temporalReachable = null;
  let temporalError = null;

  if (options.probeTemporal) {
    try {
      const client = await getTemporalClient();
      await client.workflowService.getSystemInfo({});
      temporalReachable = true;
    } catch (err) {
      temporalReachable = false;
      temporalError = err instanceof Error ? err.message : String(err);
    }
  }

  const ok = options.probeTemporal ? temporalReachable === true : true;

  return stageResult('Temporal workflow boundary', ok, {
    id: 'temporal_workflow_boundary',
    detail: options.probeTemporal
      ? temporalReachable
        ? 'Temporal server reachable; workflow.start only on setup-runs and dev scrape'
        : `Temporal unreachable: ${temporalError}`
      : 'OAuth connect and smoke test never call workflow.start (by design)',
    data: {
      paths: [
        {
          action: `Connect OAuth (Dev Integrations — ${traceCfg.displayName})`,
          http: `${traceCfg.connectEndpoint} → Google → GET /api/v1/integrations/google/callback`,
          service: 'completeGoogleOAuthCallback',
          startsTemporalWorkflow: oauthStartsWorkflow,
          workflowName: null,
        },
        {
          action: 'Smoke test',
          http: traceCfg.smokeEndpoint,
          service: traceCfg.smokeService,
          startsTemporalWorkflow: smokeStartsWorkflow,
          workflowName: null,
        },
        {
          action: 'Setup run',
          http: 'POST /api/v1/setup-runs',
          service: 'getTemporalClient().workflow.start',
          startsTemporalWorkflow: setupRunStartsWorkflow,
          workflowName: SETUP_RUN_WORKFLOW_NAME,
        },
        {
          action: 'Dev scrape',
          http: 'POST /dev/integrations/scrape',
          service: 'startSandboxScrape',
          startsTemporalWorkflow: scrapeStartsWorkflow,
          workflowName: SCRAPE_WORKFLOW_NAME,
        },
      ],
      temporalReachable,
      temporalError,
    },
    hint:
      'If you expected a workflow after OAuth, use POST /api/v1/setup-runs after connection is ready. Pass --probe-temporal to ping Temporal.',
  });
}

/**
 * @param {{
 *   businessId?: string,
 *   userId?: string,
 *   probeTemporal?: boolean,
 *   probeCallbackRoute?: boolean,
 *   ensureSandbox?: boolean,
 *   provider?: string,
 *   oauthOutcome?: string,
 *   oauthReason?: string,
 *   oauthCode?: string,
 * }} [options]
 * @returns {Promise<{
 *   provider: 'google_ads' | 'gtm' | 'gbp',
 *   businessId: string | null,
 *   userId: string | null,
 *   stages: FlowStageResult[],
 *   firstFailure: FlowStageResult | null,
 *   connectUrl: string | null,
 * }}>}
 */
async function runDevIntegrationsFlowTrace(options = {}) {
  const provider = normalizeProvider(options.provider);
  const stages = [];
  let businessId = options.businessId?.trim() || null;
  let userId = options.userId?.trim() || null;
  let connectUrl = null;
  let oauthState = null;

  stages.push(traceEnvironment(provider));
  stages.push(traceTokenCryptoPipeline());

  if (options.ensureSandbox && userId) {
    const sandbox = await ensureSandboxBusiness(userId);
    businessId = sandbox.businessId;
    stages.push(
      stageResult('Ensure sandbox business', true, {
        id: 'ensure_sandbox',
        data: sandbox,
      }),
    );
  }

  if (!businessId) {
    stages.push(
      stageResult('Business context', false, {
        id: 'business_context',
        detail: 'businessId required',
        hint: 'node scripts/traceDevIntegrationsFlow.js <businessId>',
      }),
    );
    const firstFailure = stages.find((s) => !s.ok && !s.skipped) ?? null;
    return { provider, businessId: null, userId, stages, firstFailure, connectUrl: null };
  }

  const bcStage = await traceBusinessContext(businessId);
  stages.push(bcStage);
  if (!bcStage.ok) {
    const firstFailure = stages.find((s) => !s.ok && !s.skipped) ?? null;
    return { provider, businessId, userId, stages, firstFailure, connectUrl: null };
  }

  userId = userId || String(bcStage.data?.userId || '');
  if (!userId) {
    stages.push(
      stageResult('User resolution', false, {
        id: 'user_resolution',
        detail: 'Could not resolve userId from BusinessContext',
      }),
    );
    const firstFailure = stages.find((s) => !s.ok && !s.skipped) ?? null;
    return { provider, businessId, userId: null, stages, firstFailure, connectUrl: null };
  }

  const connectStage = await traceFrontendConnectUrl(provider, businessId, userId);
  connectUrl = connectStage._connectUrl ?? null;
  oauthState = connectStage._state ?? null;
  const { _connectUrl, _state, ...connectPublic } = connectStage;
  stages.push(connectPublic);

  const parseStage = await traceOAuthCallbackParsing(provider, oauthState, businessId, userId);
  stages.push(parseStage);

  if (options.probeCallbackRoute) {
    stages.push(await traceCallbackRouteReachability());
  }

  if (options.oauthCode?.trim()) {
    stages.push(
      await traceOAuthCallbackReplay(provider, businessId, userId, options.oauthCode.trim()),
    );
  }

  stages.push(await tracePostOAuthPersistence(provider, businessId));
  stages.push(
    await traceOAuthPersistenceDiagnosis(provider, businessId, userId, {
      oauthOutcome: options.oauthOutcome,
      oauthReason: options.oauthReason,
    }),
  );
  stages.push(await traceStoredTokenPipeline(provider, businessId));
  stages.push(await traceSmokeTest(provider, businessId));
  stages.push(await traceOverview(provider, businessId));
  stages.push(await traceTemporalBoundary(provider, { probeTemporal: options.probeTemporal }));

  const firstFailure = stages.find((s) => !s.ok && !s.skipped) ?? null;

  return { provider, businessId, userId, stages, firstFailure, connectUrl };
}

/**
 * @param {FlowStageResult[]} stages
 * @returns {string}
 */
function formatTraceReport(report) {
  const lines = [];
  const providerLabel = report.provider
    ? getProviderTraceConfig(report.provider).displayName
    : DEFAULT_PROVIDER;
  lines.push('=== Dev Integrations Flow Trace ===');
  lines.push(`provider: ${report.provider ?? DEFAULT_PROVIDER} (${providerLabel})`);
  lines.push(`businessId: ${report.businessId ?? '(none)'}`);
  lines.push(`userId: ${report.userId ?? '(none)'}`);
  lines.push('');

  report.stages.forEach((s, i) => {
    const status = s.skipped ? 'SKIP' : s.ok ? 'OK' : 'FAIL';
    const prefix = `[${i + 1}/${report.stages.length}]`;
    lines.push(`${prefix} ${s.label} ... ${status}`);
    if (s.detail) lines.push(`    ${s.detail}`);
    if (s.hint) lines.push(`    hint: ${s.hint}`);
  });

  lines.push('');
  const diagnosis = report.stages.find((s) => s.id === 'oauth_persistence_diagnosis');
  if (diagnosis?.data?.verdict) {
    lines.push('');
    lines.push(`OAUTH VERDICT: ${diagnosis.data.verdict}`);
    if (diagnosis.data.completeGoogleOAuthCallbackLikelyCalled === false) {
      lines.push('  → completeGoogleOAuthCallback was likely NOT called (OAuth not finished or blocked earlier).');
    } else if (diagnosis.data.completeGoogleOAuthCallbackLikelyCalled === true) {
      lines.push('  → completeGoogleOAuthCallback was likely called (or tokens exist from a prior run).');
    }
    if (diagnosis.hint) lines.push(`  → ${diagnosis.hint}`);
  }

  lines.push('');
  if (report.firstFailure) {
    lines.push(
      `FIRST FAILURE: [${report.firstFailure.label}] — ${report.firstFailure.detail ?? 'see stage data'}`,
    );
    if (report.firstFailure.hint) lines.push(`  → ${report.firstFailure.hint}`);
  } else {
    lines.push('ALL STAGES PASSED (or skipped where OAuth browser step is required).');
  }

  if (report.connectUrl) {
    lines.push('');
    lines.push('Connect URL (same as Dev Integrations Connect OAuth button):');
    lines.push(report.connectUrl);
  }

  return lines.join('\n');
}

module.exports = {
  TRACEABLE_PROVIDERS,
  DEFAULT_PROVIDER,
  normalizeProvider,
  getProviderTraceConfig,
  runDevIntegrationsFlowTrace,
  formatTraceReport,
  traceEnvironment,
  traceBusinessContext,
  traceFrontendConnectUrl,
  traceOAuthCallbackParsing,
  traceTokenCryptoPipeline,
  traceCallbackRouteReachability,
  traceOAuthCallbackReplay,
  traceOAuthPersistenceDiagnosis,
  traceStoredTokenPipeline,
  tracePostOAuthPersistence,
  traceSmokeTest,
  traceOverview,
  traceTemporalBoundary,
};
