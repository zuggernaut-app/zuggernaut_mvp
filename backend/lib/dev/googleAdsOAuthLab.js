'use strict';

const crypto = require('crypto');
const axios = require('axios');
const mongoose = require('mongoose');
const { assertBusinessAccess } = require('../../api/v1/lib/assertBusinessAccess');
const { encryptToken, decryptToken } = require('../../lib/crypto/tokenEncryption');
const {
  buildGoogleConnectUrl,
  getOAuthRedirectUri,
} = require('../../services/integrations/googleOAuthService');
const { getFreshGoogleAccessToken } = require('../../services/integrations/googleTokenService');
const {
  listAccessibleCustomers,
  searchGoogleAdsCustomerMetadata,
  resolveMccLinkStatus,
  isMccLinkActive,
  createCustomerClientLinkInvitation,
  acceptCustomerManagerLink,
} = require('../../services/integrations/googleAdsAccountClient');
const { getConnectionStatus } = require('../../services/capabilities/integrationConnectionService');
const {
  buildGoogleAdsApiUrl,
  getGoogleAdsApiVersion,
  getGoogleAdsRequestTimeoutMs,
  normalizeCustomerId,
  getGoogleAdsDeveloperToken,
  getGoogleAdsLoginCustomerId,
  redactCustomerId,
  parseGoogleAdsApiError,
} = require('../../services/integrations/googleAdsApiConfig');
const { allScopesForProvider } = require('../../constants/googleOAuth');

const BusinessContext = mongoose.model('BusinessContext');
const IntegrationConnection = mongoose.model('IntegrationConnection');

const PROVIDER = 'google_ads';
const RETURN_PATH = '/dev/integrations/googleads';

/**
 * @typedef {object} OAuthLabStage
 * @property {string} id
 * @property {string} label
 * @property {boolean} ok
 * @property {boolean} [skipped]
 * @property {string} [detail]
 * @property {string} [hint]
 * @property {Record<string, unknown>} [data]
 */

/**
 * @param {string} label
 * @param {boolean} ok
 * @param {Partial<OAuthLabStage>} [extra]
 * @returns {OAuthLabStage}
 */
function stage(label, ok, extra = {}) {
  return {
    id: extra.id ?? label.toLowerCase().replace(/\s+/g, '_'),
    label,
    ok,
    ...extra,
  };
}

function redactToken(value) {
  if (!value || typeof value !== 'string') return null;
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function buildAdsHeaders(accessToken, { loginCustomerId, includeLoginCustomerId = true } = {}) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': getGoogleAdsDeveloperToken(),
    'Content-Type': 'application/json',
  };

  if (includeLoginCustomerId === false) {
    return headers;
  }

  const loginId =
    loginCustomerId !== undefined ? normalizeCustomerId(loginCustomerId) : getGoogleAdsLoginCustomerId();

  if (loginId) {
    headers['login-customer-id'] = loginId;
  }

  return headers;
}

function formatGoogleAdsFieldPath(location) {
  const elements = Array.isArray(location?.fieldPathElements) ? location.fieldPathElements : [];
  if (elements.length === 0) return null;
  return elements
    .map((el) => {
      const field = typeof el.fieldName === 'string' ? el.fieldName : 'field';
      return el.index != null ? `${field}[${el.index}]` : field;
    })
    .join('.');
}

function parseGoogleAdsFailure(body) {
  const details = Array.isArray(body?.error?.details) ? body.error.details : [];
  const failure = details.find((row) => String(row['@type'] ?? '').includes('GoogleAdsFailure'));
  const errors = Array.isArray(failure?.errors) ? failure.errors : [];
  const first = errors[0] ?? null;
  const fieldPath = formatGoogleAdsFieldPath(first?.location);
  return {
    googleStatus: body?.error?.status ?? null,
    googleMessage: body?.error?.message ?? null,
    authorizationError: first?.errorCode?.authorizationError ?? null,
    stepMessage: first?.message ?? null,
    fieldPath,
    requestId: failure?.requestId ?? null,
  };
}

/**
 * Bare-minimum paused SEARCH campaign payload for OAuth lab write tests (Google Ads API v24).
 *
 * @param {{ name: string, campaignBudget: string }} input
 */
function buildMinimalSearchCampaignCreate(input) {
  return {
    name: input.name,
    advertisingChannelType: 'SEARCH',
    status: 'PAUSED',
    campaignBudget: input.campaignBudget,
    containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
    manualCpc: {
      enhancedCpcEnabled: false,
    },
    networkSettings: {
      targetGoogleSearch: true,
      targetSearchNetwork: true,
      targetContentNetwork: false,
    },
  };
}

/**
 * @param {Record<string, string | undefined>} [env]
 */
function traceEnvironment(env = process.env) {
  const issues = [];
  if (!env.GOOGLE_CLIENT_ID?.trim()) issues.push('GOOGLE_CLIENT_ID missing');
  if (!env.GOOGLE_CLIENT_SECRET?.trim()) issues.push('GOOGLE_CLIENT_SECRET missing');
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) issues.push('JWT_SECRET missing or too short');
  if (!env.TOKEN_ENCRYPTION_KEY?.trim()) issues.push('TOKEN_ENCRYPTION_KEY missing');
  if (env.GOOGLE_ADS_API_ENABLED !== 'true') issues.push('GOOGLE_ADS_API_ENABLED is not true');
  if (!env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim()) issues.push('GOOGLE_ADS_DEVELOPER_TOKEN missing');

  return stage('Environment', issues.length === 0, {
    id: 'environment',
    detail: issues.length ? issues.join('; ') : 'Required env vars present',
    data: {
      googleAdsApiVersion: getGoogleAdsApiVersion(),
      googleAdsApiEnabled: env.GOOGLE_ADS_API_ENABLED === 'true',
      googleAdsLoginCustomerId: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim() || null,
      oauthRedirectUri: getOAuthRedirectUri(),
      requiredScopes: allScopesForProvider(PROVIDER),
      developerToken: redactToken(env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() ?? null),
    },
    hint:
      issues.length > 0
        ? 'Fix backend/.env and restart the API before OAuth or API tests.'
        : undefined,
  });
}

function traceTokenCrypto() {
  try {
    const sample = 'oauth-lab-crypto-probe';
    const encrypted = encryptToken(sample);
    const decrypted = decryptToken(encrypted);
    const ok = decrypted === sample;
    return stage('Token crypto', ok, {
      id: 'token_crypto',
      detail: ok ? 'encryptToken/decryptToken round-trip succeeded' : 'Decrypt did not match plaintext',
      hint: ok ? undefined : 'Fix TOKEN_ENCRYPTION_KEY in backend/.env and restart the server.',
    });
  } catch (err) {
    return stage('Token crypto', false, {
      id: 'token_crypto',
      detail: err instanceof Error ? err.message : String(err),
      hint: 'OAuth callback cannot persist tokens if encryption fails.',
    });
  }
}

/**
 * @param {string} businessId
 */
async function traceBusinessContext(businessId) {
  if (!mongoose.Types.ObjectId.isValid(businessId)) {
    return stage('Business context', false, {
      id: 'business_context',
      detail: `Invalid businessId: ${businessId}`,
      hint: 'Copy businessId from the Google Ads OAuth lab page.',
    });
  }

  const bc = await BusinessContext.findOne({ businessId }).lean();
  if (!bc) {
    return stage('Business context', false, {
      id: 'business_context',
      detail: `No BusinessContext for businessId ${businessId}`,
      hint: 'Open the lab page to create a sandbox business, or pass ?businessId=...',
    });
  }

  return stage('Business context', true, {
    id: 'business_context',
    data: {
      businessId: bc.businessId.toString(),
      userId: bc.userId.toString(),
      businessName: bc.businessName,
    },
  });
}

/**
 * @param {string} businessId
 * @param {string} userId
 */
async function traceStoredConnection(businessId) {
  const conn = await IntegrationConnection.findOne({ businessId, provider: PROVIDER })
    .select('+accessTokenEnc +refreshTokenEnc scopes tokenExpiryAt connectionHealth providerIdentifiers updatedAt')
    .lean();

  if (!conn) {
    return stage('Stored OAuth connection', false, {
      id: 'stored_connection',
      detail: 'No IntegrationConnection row for this businessId + google_ads',
      hint: 'Click Connect (OAuth) on this page. Tokens are saved per businessId, not per app user.',
      data: { mongoQuery: { businessId, provider: PROVIDER } },
    });
  }

  const hasAccess = Boolean(conn.accessTokenEnc);
  const hasRefresh = Boolean(conn.refreshTokenEnc);
  const discoveryError = conn.providerIdentifiers?.discoveryError ?? null;

  return stage('Stored OAuth connection', hasAccess, {
    id: 'stored_connection',
    detail: hasAccess
      ? `Tokens stored; health=${conn.connectionHealth}; refreshToken=${hasRefresh}`
      : 'IntegrationConnection row exists but access token is missing',
    data: {
      connectionHealth: conn.connectionHealth,
      hasAccessToken: hasAccess,
      hasRefreshToken: hasRefresh,
      scopes: conn.scopes ?? [],
      tokenExpiryAt: conn.tokenExpiryAt ?? null,
      updatedAt: conn.updatedAt ?? null,
      discoveryError,
      selectedCustomerId: redactCustomerId(conn.providerIdentifiers?.customerId),
      accessibleCustomerCount: Array.isArray(conn.providerIdentifiers?.accessibleCustomerIds)
        ? conn.providerIdentifiers.accessibleCustomerIds.length
        : null,
    },
    hint: !hasRefresh
      ? 'No refresh token — reconnect with prompt=consent so Google issues a refresh token.'
      : discoveryError
        ? 'Discovery failed on a prior run; run OAuth trace or read tests after fixing permissions.'
        : undefined,
  });
}

/**
 * @param {string} businessId
 * @param {string} userId
 */
async function traceConnectUrl(businessId, userId) {
  const access = await assertBusinessAccess(userId, businessId);
  if (!access) {
    return stage('Connect URL', false, {
      id: 'connect_url',
      detail: 'assertBusinessAccess failed — user does not own this businessId',
      hint: 'Log in as the sandbox owner or use the businessId shown on this page.',
    });
  }

  try {
    const url = buildGoogleConnectUrl({
      businessId: access.businessId.toString(),
      provider: PROVIDER,
      userId,
      returnPath: RETURN_PATH,
    });
    const parsed = new URL(url);
    const scope = parsed.searchParams.get('scope') || '';
    const ok = scope.includes('adwords') && Boolean(parsed.searchParams.get('state'));

    return stage('Connect URL', ok, {
      id: 'connect_url',
      detail: ok ? 'Authorize URL is valid for google_ads' : 'Authorize URL is missing required params',
      data: {
        returnPath: RETURN_PATH,
        redirectUri: parsed.searchParams.get('redirect_uri'),
        scopeIncludesAdwords: scope.includes('adwords'),
      },
      hint: ok ? 'Open Connect (OAuth) — you will sign in as the Google account that owns Ads access.' : undefined,
      _connectUrl: url,
    });
  } catch (err) {
    return stage('Connect URL', false, {
      id: 'connect_url',
      detail: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * @param {string} businessId
 */
async function traceTokenRefresh(businessId) {
  const conn = await IntegrationConnection.findOne({ businessId, provider: PROVIDER })
    .select('+accessTokenEnc')
    .lean();

  if (!conn?.accessTokenEnc) {
    return stage('Token refresh', false, {
      id: 'token_refresh',
      detail: 'Skipped — no stored access token',
      skipped: true,
    });
  }

  try {
    const accessToken = await getFreshGoogleAccessToken({ businessId, provider: PROVIDER });
    return stage('Token refresh', true, {
      id: 'token_refresh',
      detail: 'getFreshGoogleAccessToken succeeded',
      data: { accessTokenPreview: redactToken(accessToken) },
    });
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : 'TOKEN_REFRESH_FAILED';
    return stage('Token refresh', false, {
      id: 'token_refresh',
      detail: `${code}: ${err instanceof Error ? err.message : 'Token refresh failed'}`,
      hint:
        code === 'TOKEN_REFRESH_FAILED'
          ? 'Refresh token may be revoked — reconnect OAuth with prompt=consent.'
          : 'Check GOOGLE_CLIENT_ID/SECRET and stored tokens for this businessId.',
    });
  }
}

/**
 * @param {string} businessId
 */
async function traceListAccessibleCustomers(businessId) {
  const conn = await IntegrationConnection.findOne({ businessId, provider: PROVIDER })
    .select('+accessTokenEnc')
    .lean();

  if (!conn?.accessTokenEnc) {
    return stage('List accessible customers', false, {
      id: 'list_accessible_customers',
      detail: 'Skipped — no stored access token',
      skipped: true,
    });
  }

  try {
    const accessToken = await getFreshGoogleAccessToken({ businessId, provider: PROVIDER });
    const customerIds = await listAccessibleCustomers(accessToken);
    return stage('List accessible customers', true, {
      id: 'list_accessible_customers',
      detail: `Found ${customerIds.length} accessible customer(s)`,
      data: {
        customerCount: customerIds.length,
        customerIds: customerIds.map((id) => redactCustomerId(id)),
      },
      hint:
        customerIds.length === 0
          ? 'OAuth succeeded but Google returned no accessible customers — check Ads account linkage.'
          : 'Select a customer below before write tests.',
    });
  } catch (err) {
    const googleErrorSummary =
      err && typeof err === 'object' && 'details' in err && err.details
        ? err.details
        : parseGoogleAdsApiError(403, null, { action: 'listAccessibleCustomers' });
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : 'GOOGLE_ADS_LIST_CUSTOMERS_FAILED';

    return stage('List accessible customers', false, {
      id: 'list_accessible_customers',
      detail: `${code}: ${err instanceof Error ? err.message : 'listAccessibleCustomers failed'}`,
      data: { googleErrorSummary },
      hint:
        'OAuth tokens are saved, but Google rejected listAccessibleCustomers. Check developer token, Ads user role, and MCC linkage — not the Zuggernaut user email.',
    });
  }
}

/**
 * @param {string} businessId
 */
async function traceConnectionStatus(businessId) {
  const status = await getConnectionStatus(businessId, PROVIDER, { attemptRefresh: true });
  const ok =
    status.reason !== 'missing_connection' &&
    status.reason !== 'not_connected' &&
    status.reason !== 'needs_reauth';

  return stage('Connection status', ok, {
    id: 'connection_status',
    detail: `ready=${status.ready}; reason=${status.reason}; health=${status.connectionHealth ?? 'null'}`,
    data: {
      ready: status.ready,
      reason: status.reason,
      connectionHealth: status.connectionHealth,
      nextAction: status.nextAction ?? null,
      scopesGranted: status.scopesGranted ?? [],
      scopesMissing: status.scopesMissing ?? [],
    },
    hint: !ok ? 'Complete OAuth for this businessId before read/write tests.' : undefined,
  });
}

/**
 * @param {string} businessId
 * @param {string} userId
 */
async function runOAuthTrace(businessId, userId) {
  const stages = [];
  let connectUrl = null;

  stages.push(traceEnvironment());
  stages.push(traceTokenCrypto());

  const bcStage = await traceBusinessContext(businessId);
  stages.push(bcStage);
  if (!bcStage.ok) {
    return buildTraceReport({ businessId, userId, stages, connectUrl });
  }

  const resolvedUserId = userId || String(bcStage.data?.userId || '');
  const connectStage = await traceConnectUrl(businessId, resolvedUserId);
  connectUrl = connectStage._connectUrl ?? null;
  const { _connectUrl, ...connectPublic } = connectStage;
  stages.push(connectPublic);

  stages.push(await traceStoredConnection(businessId));
  stages.push(await traceConnectionStatus(businessId));
  stages.push(await traceTokenRefresh(businessId));
  stages.push(await traceListAccessibleCustomers(businessId));

  return buildTraceReport({ businessId, userId: resolvedUserId, stages, connectUrl });
}

/**
 * @param {object} report
 */
function buildTraceReport(report) {
  const firstFailure = report.stages.find((s) => !s.ok && !s.skipped) ?? null;
  const oauthVerdict = report.stages.find((s) => s.id === 'stored_connection');
  return {
    ...report,
    provider: PROVIDER,
    returnPath: RETURN_PATH,
    firstFailure,
    oauthLikelyComplete: oauthVerdict?.data?.hasAccessToken === true,
  };
}

/**
 * @param {unknown} body
 */
function summarizeCampaignSearchResults(body) {
  const rows = Array.isArray(body?.results) ? body.results : [];
  const campaigns = rows
    .map((row) => {
      const campaign = row?.campaign;
      if (!campaign || typeof campaign !== 'object') return null;
      return {
        id: campaign.id != null ? String(campaign.id) : null,
        name: typeof campaign.name === 'string' ? campaign.name : null,
        status: typeof campaign.status === 'string' ? campaign.status : null,
        resourceName: typeof campaign.resourceName === 'string' ? campaign.resourceName : null,
      };
    })
    .filter(Boolean);

  return {
    campaignCount: campaigns.length,
    campaigns: campaigns.slice(0, 10),
    truncated: campaigns.length > 10,
  };
}

/**
 * @param {object} params
 */
async function runAdsApiStep(params) {
  const {
    stepId,
    kind,
    customerId,
    accessToken,
    method,
    resourcePath,
    body,
    loginCustomerId,
    includeLoginCustomerId = true,
    enrichSuccessData,
    formatSuccessDetail,
  } = params;

  const url = buildGoogleAdsApiUrl(resourcePath);
  const headers = buildAdsHeaders(accessToken, { loginCustomerId, includeLoginCustomerId });

  try {
    const res = await axios({
      method,
      url,
      data: body,
      headers,
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    });

    if (res.status >= 200 && res.status < 300) {
      const enriched = typeof enrichSuccessData === 'function' ? enrichSuccessData(res.data) : {};
      const detail =
        typeof formatSuccessDetail === 'function'
          ? formatSuccessDetail(res.status, res.data, enriched)
          : `HTTP ${res.status} — ${kind} succeeded`;

      return stage(stepId, true, {
        id: stepId,
        label: stepId,
        detail,
        data: {
          kind,
          statusCode: res.status,
          resourceName:
            res.data?.results?.[0]?.resourceName ??
            res.data?.result?.resourceName ??
            enriched.resourceName ??
            null,
          loginCustomerId: redactCustomerId(headers['login-customer-id']),
          targetCustomerId: redactCustomerId(customerId),
          ...enriched,
        },
      });
    }

    const parsed = parseGoogleAdsFailure(res.data);
    const googleErrorSummary = parseGoogleAdsApiError(res.status, res.data, {
      action: stepId,
      customerIds: [customerId],
    });

    const fieldHint = parsed.fieldPath ? ` (field: ${parsed.fieldPath})` : '';
    return stage(stepId, false, {
      id: stepId,
      label: stepId,
      detail: `${parsed.googleStatus ?? 'ERROR'}: ${parsed.stepMessage ?? parsed.googleMessage ?? `HTTP ${res.status}`}${fieldHint}`,
      data: {
        kind,
        statusCode: res.status,
        authorizationError: parsed.authorizationError,
        fieldPath: parsed.fieldPath,
        googleErrorSummary,
        loginCustomerId: redactCustomerId(headers['login-customer-id']),
        targetCustomerId: redactCustomerId(customerId),
      },
      hint:
        parsed.authorizationError === 'USER_PERMISSION_DENIED'
          ? 'OAuth Google user lacks permission on this customer account.'
          : parsed.authorizationError === 'DEVELOPER_TOKEN_NOT_APPROVED'
            ? 'Developer token access level may block this operation.'
            : undefined,
    });
  } catch (err) {
    return stage(stepId, false, {
      id: stepId,
      label: stepId,
      detail: err instanceof Error ? err.message : String(err),
      data: { kind },
    });
  }
}

/**
 * @param {string} businessId
 * @param {{
 *   customerId?: string,
 *   managerCustomerId?: string,
 *   includeCampaign?: boolean,
 *   mode?: 'read' | 'write' | 'all',
 * }} [options]
 */
async function runReadWriteTests(businessId, options = {}) {
  const startedAt = new Date().toISOString();
  const stages = [];
  const suffix = crypto.randomUUID().slice(0, 8);
  const mode = options.mode === 'read' || options.mode === 'write' ? options.mode : 'all';
  const runRead = mode === 'read' || mode === 'all';
  const runWrite = mode === 'write' || mode === 'all';

  stages.push(traceEnvironment());
  stages.push(await traceStoredConnection(businessId));

  const conn = await IntegrationConnection.findOne({ businessId, provider: PROVIDER })
    .select('+accessTokenEnc providerIdentifiers')
    .lean();

  if (!conn?.accessTokenEnc) {
    return finalizeReadWriteReport({
      businessId,
      startedAt,
      stages,
      mode,
      message: 'Connect google_ads OAuth for this businessId before read/write tests.',
      customerId: null,
      managerCustomerId: null,
      linkReady: false,
    });
  }

  let accessToken;
  try {
    accessToken = await getFreshGoogleAccessToken({ businessId, provider: PROVIDER });
    stages.push(
      stage('Token refresh', true, {
        id: 'token_refresh',
        detail: 'Access token ready for API calls',
      }),
    );
  } catch (err) {
    const refreshStage = stage('Token refresh', false, {
      id: 'token_refresh',
      detail: err instanceof Error ? err.message : 'Token refresh failed',
    });
    stages.push(refreshStage);
    return finalizeReadWriteReport({
      businessId,
      startedAt,
      stages,
      mode,
      message: refreshStage.detail,
      linkReady: false,
    });
  }

  const ids = conn.providerIdentifiers ?? {};
  const managerCustomerId =
    normalizeCustomerId(options.managerCustomerId) || getGoogleAdsLoginCustomerId();
  const customerId =
    normalizeCustomerId(options.customerId) ||
    normalizeCustomerId(ids.customerId) ||
    normalizeCustomerId(ids.accessibleCustomerIds?.find((id) => normalizeCustomerId(id) !== managerCustomerId)) ||
    normalizeCustomerId(process.env.GOOGLE_ADS_PREFERRED_TEST_CUSTOMER_ID);

  if (!managerCustomerId || !customerId) {
    const missingStage = stage('Resolve manager and client', false, {
      id: 'resolve_manager_client',
      detail: 'managerCustomerId and client customerId are required for read/write tests',
      hint: 'Select manager and client accounts in the MCC linking section.',
    });
    stages.push(missingStage);
    return finalizeReadWriteReport({
      businessId,
      startedAt,
      stages,
      mode,
      message: missingStage.detail,
      customerId: customerId ? redactCustomerId(customerId) : null,
      managerCustomerId: managerCustomerId ? redactCustomerId(managerCustomerId) : null,
      linkReady: false,
    });
  }

  if (managerCustomerId === customerId) {
    const sameStage = stage('Resolve manager and client', false, {
      id: 'resolve_manager_client',
      detail: 'Manager and client must be different accounts',
    });
    stages.push(sameStage);
    return finalizeReadWriteReport({
      businessId,
      startedAt,
      stages,
      mode,
      message: sameStage.detail,
      customerId: redactCustomerId(customerId),
      managerCustomerId: redactCustomerId(managerCustomerId),
      linkReady: false,
    });
  }

  stages.push(
    stage('Resolve manager and client', true, {
      id: 'resolve_manager_client',
      detail: `Manager …${managerCustomerId.slice(-4)} → client …${customerId.slice(-4)} (${mode} tests)`,
      data: {
        managerCustomerId: redactCustomerId(managerCustomerId),
        customerId: redactCustomerId(customerId),
        mode,
      },
    }),
  );

  let linkReady = false;
  try {
    const resolved = await resolveMccLinkStatus(accessToken, managerCustomerId, customerId);
    linkReady = resolved.linkReady === true;
    stages.push(
      stage('Check MCC link', linkReady, {
        id: 'check_mcc_link',
        detail: linkReady
          ? `Link ACTIVE — manager=${resolved.managerView.status ?? 'none'}, client=${resolved.clientView.status ?? 'none'}`
          : `Link not ready — manager=${resolved.managerView.status ?? 'none'}, client=${resolved.clientView.status ?? 'none'}`,
        data: {
          linkReady,
          managerView: {
            status: resolved.managerView.status,
            managerLinkId: resolved.managerView.managerLinkId,
          },
          clientView: {
            status: resolved.clientView.status,
            managerLinkId: resolved.clientView.managerLinkId,
          },
        },
        hint: linkReady
          ? undefined
          : 'Send and accept the MCC link invitation before read/write tests.',
      }),
    );
  } catch (err) {
    const linkStage = stage('Check MCC link', false, {
      id: 'check_mcc_link',
      detail: err instanceof Error ? err.message : 'Failed to verify MCC link status',
    });
    stages.push(linkStage);
    return finalizeReadWriteReport({
      businessId,
      startedAt,
      stages,
      mode,
      message: linkStage.detail,
      customerId: redactCustomerId(customerId),
      managerCustomerId: redactCustomerId(managerCustomerId),
      linkReady: false,
    });
  }

  if (!linkReady) {
    return finalizeReadWriteReport({
      businessId,
      startedAt,
      stages,
      mode,
      message: 'MCC link must be ACTIVE before read/write tests.',
      customerId: redactCustomerId(customerId),
      managerCustomerId: redactCustomerId(managerCustomerId),
      linkReady: false,
    });
  }

  if (runRead) {
    stages.push(
      await runAdsApiStep({
        stepId: 'read_customer_metadata',
        kind: 'read',
        customerId,
        accessToken,
        method: 'POST',
        resourcePath: `customers/${customerId}/googleAds:search`,
        body: {
          query:
            'SELECT customer.id, customer.descriptive_name, customer.manager, customer.status, customer.test_account FROM customer LIMIT 1',
        },
        loginCustomerId: managerCustomerId,
      }),
    );

    stages.push(
      await runAdsApiStep({
        stepId: 'read_customer_user_access',
        kind: 'read',
        customerId,
        accessToken,
        method: 'POST',
        resourcePath: `customers/${customerId}/googleAds:search`,
        body: {
          query:
            'SELECT customer_user_access.user_id, customer_user_access.email_address, customer_user_access.access_role FROM customer_user_access LIMIT 20',
        },
        loginCustomerId: managerCustomerId,
      }),
    );

    stages.push(
      await runAdsApiStep({
        stepId: 'read_mcc_customer_client_link',
        kind: 'read',
        customerId: managerCustomerId,
        accessToken,
        method: 'POST',
        resourcePath: `customers/${managerCustomerId}/googleAds:search`,
        body: {
          query: [
            'SELECT customer_client_link.resource_name, customer_client_link.manager_link_id,',
            'customer_client_link.status, customer_client_link.client_customer',
            'FROM customer_client_link',
            `WHERE customer_client_link.client_customer = 'customers/${customerId}'`,
          ].join(' '),
        },
        loginCustomerId: managerCustomerId,
      }),
    );

    stages.push(
      await runAdsApiStep({
        stepId: 'read_campaigns',
        kind: 'read',
        customerId,
        accessToken,
        method: 'POST',
        resourcePath: `customers/${customerId}/googleAds:search`,
        body: {
          query: [
            'SELECT campaign.id, campaign.name, campaign.status, campaign.resource_name,',
            'campaign.advertising_channel_type',
            'FROM campaign',
            'ORDER BY campaign.id',
            'LIMIT 25',
          ].join(' '),
        },
        loginCustomerId: managerCustomerId,
        enrichSuccessData: summarizeCampaignSearchResults,
        formatSuccessDetail: (status, _body, enriched) => {
          const count = enriched.campaignCount ?? 0;
          const suffix = enriched.truncated ? ' (showing first 10)' : '';
          return `HTTP ${status} — found ${count} campaign${count === 1 ? '' : 's'}${suffix}`;
        },
      }),
    );
  }

  if (runWrite) {
    const budgetResult = await runAdsApiStep({
      stepId: 'write_campaign_budget',
      kind: 'write',
      customerId,
      accessToken,
      method: 'POST',
      resourcePath: `customers/${customerId}/campaignBudgets:mutate`,
      body: {
        operations: [
          {
            create: {
              name: `ZUG_OAUTH_LAB_BUDGET_${suffix}`,
              amountMicros: '10000000',
              deliveryMethod: 'STANDARD',
              explicitlyShared: false,
            },
          },
        ],
      },
      loginCustomerId: managerCustomerId,
    });
    stages.push(budgetResult);

    stages.push(
      await runAdsApiStep({
        stepId: 'write_conversion_action',
        kind: 'write',
        customerId,
        accessToken,
        method: 'POST',
        resourcePath: `customers/${customerId}/conversionActions:mutate`,
        body: {
          operations: [
            {
              create: {
                name: `ZUG_OAUTH_LAB_CONV_${suffix}`,
                category: 'DEFAULT',
                type: 'WEBPAGE',
                status: 'ENABLED',
                countingType: 'ONE_PER_CLICK',
              },
            },
          ],
        },
        loginCustomerId: managerCustomerId,
      }),
    );

    const budgetResourceName = budgetResult.data?.resourceName ?? null;
    if (budgetResult.ok && budgetResourceName) {
      stages.push(
        await runAdsApiStep({
          stepId: 'write_search_campaign',
          kind: 'write',
          customerId,
          accessToken,
          method: 'POST',
          resourcePath: `customers/${customerId}/campaigns:mutate`,
          body: {
            operations: [
              {
                create: buildMinimalSearchCampaignCreate({
                  name: `ZUG_OAUTH_LAB_CAMPAIGN_${suffix}`,
                  campaignBudget: budgetResourceName,
                }),
              },
            ],
          },
          loginCustomerId: managerCustomerId,
          formatSuccessDetail: (status, body) => {
            const resourceName = body?.results?.[0]?.resourceName ?? null;
            return resourceName
              ? `HTTP ${status} — created paused SEARCH campaign (${resourceName})`
              : `HTTP ${status} — write succeeded`;
          },
        }),
      );
    } else {
      stages.push(
        stage('write_search_campaign', false, {
          id: 'write_search_campaign',
          label: 'write_search_campaign',
          skipped: true,
          detail: 'Skipped — campaign budget write must succeed first',
        }),
      );
    }
  }

  return finalizeReadWriteReport({
    businessId,
    startedAt,
    stages,
    mode,
    customerId,
    managerCustomerId,
    linkReady: true,
    message:
      mode === 'read'
        ? 'Read test run completed.'
        : mode === 'write'
          ? 'Write test run completed.'
          : 'Read/write test run completed.',
  });
}

/**
 * @param {object} payload
 */
function finalizeReadWriteReport(payload) {
  const {
    businessId,
    startedAt,
    stages,
    message,
    customerId,
    managerCustomerId,
    mode = 'all',
    linkReady = false,
  } = payload;
  const actionableStages = stages.filter((s) => !s.skipped);
  const ok = linkReady && actionableStages.length > 0 && actionableStages.every((s) => s.ok);
  const firstFailure = stages.find((s) => !s.ok && !s.skipped) ?? null;

  return {
    provider: PROVIDER,
    businessId,
    mode,
    linkReady,
    customerId:
      customerId && !String(customerId).includes('…')
        ? redactCustomerId(customerId)
        : (customerId ?? null),
    managerCustomerId:
      managerCustomerId && !String(managerCustomerId).includes('…')
        ? redactCustomerId(managerCustomerId)
        : (managerCustomerId ?? null),
    startedAt,
    completedAt: new Date().toISOString(),
    ok,
    message,
    stages,
    firstFailure,
    summary: {
      total: actionableStages.length,
      passed: actionableStages.filter((s) => s.ok).length,
      failed: actionableStages.filter((s) => !s.ok).length,
      skipped: stages.filter((s) => s.skipped).length,
    },
  };
}

/**
 * @param {import('./googleAdsOAuthLab').OAuthLabTraceReport} report
 */
function formatOAuthTraceReport(report) {
  const lines = [];
  lines.push('=== Google Ads OAuth Lab Trace ===');
  lines.push(`businessId: ${report.businessId ?? '(none)'}`);
  lines.push(`userId: ${report.userId ?? '(none)'}`);
  lines.push(`returnPath: ${report.returnPath}`);
  lines.push('');

  report.stages.forEach((s, i) => {
    const status = s.skipped ? 'SKIP' : s.ok ? 'OK' : 'FAIL';
    lines.push(`[${i + 1}/${report.stages.length}] ${s.label} ... ${status}`);
    if (s.detail) lines.push(`    ${s.detail}`);
    if (s.hint) lines.push(`    hint: ${s.hint}`);
  });

  lines.push('');
  lines.push(`OAuth likely complete: ${report.oauthLikelyComplete ? 'yes' : 'no'}`);
  if (report.firstFailure) {
    lines.push('');
    lines.push(`FIRST FAILURE: [${report.firstFailure.label}] — ${report.firstFailure.detail ?? ''}`);
    if (report.firstFailure.hint) lines.push(`  → ${report.firstFailure.hint}`);
  }
  if (report.connectUrl) {
    lines.push('');
    lines.push('Connect URL:');
    lines.push(report.connectUrl);
  }
  return lines.join('\n');
}

/**
 * @param {ReturnType<typeof finalizeReadWriteReport>} report
 */
function formatReadWriteReport(report) {
  const lines = [];
  lines.push('=== Google Ads Read/Write Lab ===');
  lines.push(`businessId: ${report.businessId}`);
  lines.push(`customerId: ${report.customerId ?? '(none)'}`);
  lines.push(`summary: ${report.summary.passed}/${report.summary.total} passed`);
  lines.push('');

  report.stages.forEach((s, i) => {
    const status = s.skipped ? 'SKIP' : s.ok ? 'OK' : 'FAIL';
    lines.push(`[${i + 1}/${report.stages.length}] ${s.label ?? s.id} ... ${status}`);
    if (s.detail) lines.push(`    ${s.detail}`);
    if (s.hint) lines.push(`    hint: ${s.hint}`);
  });

  if (report.firstFailure) {
    lines.push('');
    lines.push(`FIRST FAILURE: [${report.firstFailure.label ?? report.firstFailure.id}] — ${report.firstFailure.detail ?? ''}`);
    if (report.firstFailure.hint) lines.push(`  → ${report.firstFailure.hint}`);
  }

  return lines.join('\n');
}

/**
 * @param {string} businessId
 * @param {{
 *   managerCustomerId?: string,
 *   clientCustomerId?: string,
 *   sendInvitation?: boolean,
 *   acceptLink?: boolean,
 * }} [options]
 */
async function runMccLinkFlow(businessId, options = {}) {
  const startedAt = new Date().toISOString();
  const stages = [];

  stages.push(await traceStoredConnection(businessId));
  const conn = await IntegrationConnection.findOne({ businessId, provider: PROVIDER })
    .select('+accessTokenEnc')
    .lean();

  if (!conn?.accessTokenEnc) {
    return finalizeMccLinkReport({
      businessId,
      startedAt,
      stages,
      message: 'Connect google_ads OAuth before MCC link steps.',
      linkReady: false,
    });
  }

  let accessToken;
  try {
    accessToken = await getFreshGoogleAccessToken({ businessId, provider: PROVIDER });
    stages.push(
      stage('Token refresh', true, {
        id: 'token_refresh',
        detail: 'Access token ready for MCC link calls',
      }),
    );
  } catch (err) {
    const refreshStage = stage('Token refresh', false, {
      id: 'token_refresh',
      detail: err instanceof Error ? err.message : 'Token refresh failed',
    });
    stages.push(refreshStage);
    return finalizeMccLinkReport({
      businessId,
      startedAt,
      stages,
      message: refreshStage.detail,
      linkReady: false,
    });
  }

  const managerCustomerId =
    normalizeCustomerId(options.managerCustomerId) || getGoogleAdsLoginCustomerId();
  const clientCustomerId = normalizeCustomerId(options.clientCustomerId);

  if (!managerCustomerId || !clientCustomerId) {
    const missing = stage('Resolve manager and client', false, {
      id: 'resolve_manager_client',
      detail: 'managerCustomerId and clientCustomerId are required',
      hint: 'Pick manager (MCC) and client accounts, or set GOOGLE_ADS_LOGIN_CUSTOMER_ID for the manager.',
    });
    stages.push(missing);
    return finalizeMccLinkReport({
      businessId,
      startedAt,
      stages,
      message: missing.detail,
      linkReady: false,
    });
  }

  if (managerCustomerId === clientCustomerId) {
    const same = stage('Resolve manager and client', false, {
      id: 'resolve_manager_client',
      detail: 'Manager and client must be different accounts',
    });
    stages.push(same);
    return finalizeMccLinkReport({
      businessId,
      startedAt,
      stages,
      message: same.detail,
      linkReady: false,
    });
  }

  stages.push(
    stage('Resolve manager and client', true, {
      id: 'resolve_manager_client',
      detail: `Manager …${managerCustomerId.slice(-4)} → client …${clientCustomerId.slice(-4)}`,
      data: {
        managerCustomerId: redactCustomerId(managerCustomerId),
        clientCustomerId: redactCustomerId(clientCustomerId),
      },
    }),
  );

  try {
    const managerMeta = await searchGoogleAdsCustomerMetadata(accessToken, managerCustomerId);
    stages.push(
      stage('Manager metadata', managerMeta?.manager === true, {
        id: 'manager_metadata',
        detail:
          managerMeta?.manager === true
            ? `${managerMeta.descriptiveName ?? 'Manager'} (manager=true)`
            : `Account …${managerCustomerId.slice(-4)} is not a manager account`,
        data: {
          descriptiveName: managerMeta?.descriptiveName ?? null,
          manager: managerMeta?.manager ?? null,
          status: managerMeta?.status ?? null,
        },
        hint:
          managerMeta?.manager !== true
            ? 'Pick an account where customer.manager=true (your MCC).'
            : undefined,
      }),
    );
  } catch (err) {
    stages.push(
      stage('Manager metadata', false, {
        id: 'manager_metadata',
        detail: err instanceof Error ? err.message : 'Failed to read manager metadata',
      }),
    );
  }

  try {
    const clientMeta = await searchGoogleAdsCustomerMetadata(accessToken, clientCustomerId);
    stages.push(
      stage('Client metadata', !clientMeta?.metadataError, {
        id: 'client_metadata',
        detail: clientMeta?.metadataError
          ? `Could not read client …${clientCustomerId.slice(-4)} metadata`
          : `${clientMeta?.descriptiveName ?? 'Client'} (manager=${clientMeta?.manager === true})`,
        data: {
          descriptiveName: clientMeta?.descriptiveName ?? null,
          manager: clientMeta?.manager ?? null,
          status: clientMeta?.status ?? null,
          authorizationError: clientMeta?.authorizationError ?? null,
        },
      }),
    );
  } catch (err) {
    stages.push(
      stage('Client metadata', false, {
        id: 'client_metadata',
        detail: err instanceof Error ? err.message : 'Failed to read client metadata',
      }),
    );
  }

  let linkStatus = null;
  let managerLinkView = null;
  let clientLinkView = null;
  try {
    const resolved = await resolveMccLinkStatus(accessToken, managerCustomerId, clientCustomerId);
    linkStatus = resolved.linkStatus;
    managerLinkView = resolved.managerView;
    clientLinkView = resolved.clientView;
    let linkReady = isMccLinkActive({ managerView: managerLinkView, clientView: clientLinkView });
    stages.push(
      stage('Query existing link', true, {
        id: 'query_existing_link',
        detail: linkStatus.status
          ? `Link status=${linkStatus.status} (${linkStatus.source ?? 'unknown'} view)`
          : 'No manager/client link found for this pair',
        data: {
          status: linkStatus.status,
          managerLinkId: linkStatus.managerLinkId,
          resourceName: linkStatus.resourceName,
          source: linkStatus.source ?? null,
          managerView: {
            status: managerLinkView.status,
            managerLinkId: managerLinkView.managerLinkId,
          },
          clientView: {
            status: clientLinkView.status,
            managerLinkId: clientLinkView.managerLinkId,
          },
          linkReady,
        },
        hint: linkReady
          ? 'Link is ACTIVE — read/write tests can use login-customer-id from the manager.'
          : linkStatus.status === 'PENDING'
            ? 'Invitation is pending — accept from the client account (button below or Google Ads UI).'
            : 'Send a link invitation from the manager account.',
      }),
    );

    if (linkReady) {
      return finalizeMccLinkReport({
        businessId,
        startedAt,
        stages,
        message: 'MCC link is ACTIVE.',
        linkReady: true,
        managerCustomerId,
        clientCustomerId,
        linkStatus,
      });
    }

    if (options.sendInvitation && linkStatus.status !== 'PENDING') {
      const invitation = await createCustomerClientLinkInvitation(
        accessToken,
        managerCustomerId,
        clientCustomerId
      );
      linkStatus = {
        status: invitation.status,
        managerLinkId: invitation.managerLinkId,
        resourceName: invitation.resourceName,
      };
      stages.push(
        stage('Send link invitation', true, {
          id: 'send_link_invitation',
          detail: `Created CustomerClientLink status=${invitation.status}`,
          data: {
            resourceName: invitation.resourceName,
            managerLinkId: invitation.managerLinkId,
            status: invitation.status,
          },
          hint: 'Accept the invitation from the client account (API button or Google Ads UI).',
        }),
      );
    } else if (options.sendInvitation) {
      stages.push(
        stage('Send link invitation', true, {
          id: 'send_link_invitation',
          skipped: true,
          detail: 'Skipped — link invitation already PENDING',
          data: linkStatus,
        }),
      );
    }

    if (options.acceptLink) {
      const refreshed = await resolveMccLinkStatus(accessToken, managerCustomerId, clientCustomerId);
      managerLinkView = refreshed.managerView;
      clientLinkView = refreshed.clientView;
      const pendingLink = refreshed.pending;
      stages.push(
        stage('Refresh pending link check', true, {
          id: 'refresh_pending_link',
          detail: pendingLink
            ? `Found PENDING link via ${pendingLink.source} view (managerLinkId=${pendingLink.managerLinkId})`
            : `No PENDING link — manager=${managerLinkView.status ?? 'none'}, client=${clientLinkView.status ?? 'none'}`,
          data: {
            managerView: {
              status: managerLinkView.status,
              managerLinkId: managerLinkView.managerLinkId,
            },
            clientView: {
              status: clientLinkView.status,
              managerLinkId: clientLinkView.managerLinkId,
            },
            pending: pendingLink
              ? {
                  status: pendingLink.status,
                  managerLinkId: pendingLink.managerLinkId,
                  source: pendingLink.source,
                }
              : null,
          },
          hint: pendingLink
            ? 'Proceeding to accept the pending invitation from the client account.'
            : 'Send invitation first, wait for PENDING on manager or client view, then accept.',
        }),
      );

      if (pendingLink?.managerLinkId) {
        linkStatus = pendingLink;
        const accepted = await acceptCustomerManagerLink(
          accessToken,
          clientCustomerId,
          managerCustomerId,
          pendingLink.managerLinkId
        );
        stages.push(
          stage('Accept link (client)', true, {
            id: 'accept_link',
            detail: `CustomerManagerLink status=${accepted.status}`,
            data: accepted,
          }),
        );
        const afterAccept = await resolveMccLinkStatus(accessToken, managerCustomerId, clientCustomerId);
        linkStatus = afterAccept.linkStatus;
        managerLinkView = afterAccept.managerView;
        clientLinkView = afterAccept.clientView;
        linkReady = isMccLinkActive({ managerView: managerLinkView, clientView: clientLinkView });
        stages.push(
          stage('Re-check link status', linkReady, {
            id: 'recheck_link_status',
            detail: linkReady
              ? `Link ACTIVE — manager=${managerLinkView.status ?? 'none'}, client=${clientLinkView.status ?? 'none'}`
              : `Link status=${linkStatus.status ?? 'unknown'} (${linkStatus.source ?? 'unknown'} view)`,
            data: {
              status: linkStatus.status,
              managerLinkId: linkStatus.managerLinkId,
              managerView: {
                status: managerLinkView.status,
                managerLinkId: managerLinkView.managerLinkId,
              },
              clientView: {
                status: clientLinkView.status,
                managerLinkId: clientLinkView.managerLinkId,
              },
            },
          }),
        );
      } else {
        linkStatus = refreshed.linkStatus;
        stages.push(
          stage('Accept link (client)', false, {
            id: 'accept_link',
            skipped: true,
            detail: 'Skipped — no PENDING link with managerLinkId to accept',
            hint: 'Send invitation first, then accept when status is PENDING on manager or client view.',
          }),
        );
      }
    }

    linkReady = isMccLinkActive({ managerView: managerLinkView, clientView: clientLinkView });
    return finalizeMccLinkReport({
      businessId,
      startedAt,
      stages,
      message: linkReady
        ? 'MCC link is ACTIVE.'
        : linkStatus?.status === 'PENDING'
          ? 'Link invitation is PENDING — accept to continue.'
          : 'MCC link is not ready.',
      linkReady,
      managerCustomerId,
      clientCustomerId,
      linkStatus,
    });
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : 'ADS_LINK_FAILED';
    stages.push(
      stage('MCC link operation', false, {
        id: 'mcc_link_operation',
        detail: `${code}: ${err instanceof Error ? err.message : 'MCC link failed'}`,
        data: err && typeof err === 'object' && 'details' in err ? { googleErrorSummary: err.details } : undefined,
        hint:
          'OAuth user must have access on the manager account to invite, and on the client to accept.',
      }),
    );
    return finalizeMccLinkReport({
      businessId,
      startedAt,
      stages,
      message: err instanceof Error ? err.message : 'MCC link failed',
      linkReady: false,
      managerCustomerId,
      clientCustomerId,
    });
  }
}

/**
 * @param {object} payload
 */
function finalizeMccLinkReport(payload) {
  const {
    businessId,
    startedAt,
    stages,
    message,
    linkReady,
    managerCustomerId,
    clientCustomerId,
    linkStatus,
  } = payload;
  const actionableStages = stages.filter((s) => !s.skipped);
  const firstFailure = stages.find((s) => !s.ok && !s.skipped) ?? null;

  return {
    provider: PROVIDER,
    businessId,
    startedAt,
    completedAt: new Date().toISOString(),
    ok: linkReady === true,
    linkReady: linkReady === true,
    message,
    managerCustomerId: managerCustomerId ? redactCustomerId(managerCustomerId) : null,
    clientCustomerId: clientCustomerId ? redactCustomerId(clientCustomerId) : null,
    linkStatus: linkStatus ?? null,
    stages,
    firstFailure,
    summary: {
      total: actionableStages.length,
      passed: actionableStages.filter((s) => s.ok).length,
      failed: actionableStages.filter((s) => !s.ok).length,
      skipped: stages.filter((s) => s.skipped).length,
    },
  };
}

module.exports = {
  PROVIDER,
  RETURN_PATH,
  runOAuthTrace,
  runMccLinkFlow,
  runReadWriteTests,
  formatOAuthTraceReport,
  formatReadWriteReport,
  traceEnvironment,
  traceStoredConnection,
  buildMinimalSearchCampaignCreate,
  parseGoogleAdsFailure,
};
