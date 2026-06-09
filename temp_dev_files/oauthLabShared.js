'use strict';

const mongoose = require('mongoose');
const { assertBusinessAccess } = require('../../api/v1/lib/assertBusinessAccess');
const { encryptToken, decryptToken } = require('../../lib/crypto/tokenEncryption');
const { buildGoogleConnectUrl } = require('../../services/integrations/googleOAuthService');
const { getFreshGoogleAccessToken } = require('../../services/integrations/googleTokenService');
const { getConnectionStatus } = require('../../services/capabilities/integrationConnectionService');
const { allScopesForProvider } = require('../../constants/googleOAuth');

const BusinessContext = mongoose.model('BusinessContext');
const IntegrationConnection = mongoose.model('IntegrationConnection');

/**
 * @param {string} label
 * @param {boolean} ok
 * @param {Record<string, unknown>} [extra]
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
      hint: 'Copy businessId from the OAuth lab page.',
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
 * @param {string} provider
 * @param {(conn: object) => Record<string, unknown>} [extraData]
 */
async function traceStoredConnection(businessId, provider, extraData) {
  const conn = await IntegrationConnection.findOne({ businessId, provider })
    .select('+accessTokenEnc +refreshTokenEnc scopes tokenExpiryAt connectionHealth providerIdentifiers updatedAt')
    .lean();

  if (!conn) {
    return stage('Stored OAuth connection', false, {
      id: 'stored_connection',
      detail: `No IntegrationConnection row for this businessId + ${provider}`,
      hint: 'Click Connect (OAuth) on this page. Tokens are saved per businessId.',
      data: { mongoQuery: { businessId, provider } },
    });
  }

  const hasAccess = Boolean(conn.accessTokenEnc);
  const hasRefresh = Boolean(conn.refreshTokenEnc);

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
      ...(typeof extraData === 'function' ? extraData(conn) : {}),
    },
    hint: !hasRefresh
      ? 'No refresh token — reconnect with prompt=consent so Google issues a refresh token.'
      : undefined,
  });
}

/**
 * @param {string} businessId
 * @param {string} provider
 */
async function traceConnectionStatus(businessId, provider) {
  const status = await getConnectionStatus(businessId, provider, { attemptRefresh: true });
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
    hint: !ok ? `Complete OAuth for ${provider} before API tests.` : undefined,
  });
}

/**
 * @param {string} businessId
 * @param {string} provider
 */
async function traceTokenRefresh(businessId, provider) {
  const conn = await IntegrationConnection.findOne({ businessId, provider })
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
    const accessToken = await getFreshGoogleAccessToken({ businessId, provider });
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
 * @param {string} userId
 * @param {string} provider
 * @param {string} returnPath
 */
async function traceConnectUrl(businessId, userId, provider, returnPath) {
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
      provider,
      userId,
      returnPath,
    });
    const parsed = new URL(url);
    const scope = parsed.searchParams.get('scope') || '';
    const requiredScopes = allScopesForProvider(provider);
    const scopeOk = requiredScopes.every((s) => scope.includes(s.split('/').pop() ?? s));
    const ok = Boolean(parsed.searchParams.get('state')) && (requiredScopes.length === 0 || scope.length > 0);

    return stage('Connect URL', ok, {
      id: 'connect_url',
      detail: ok ? `Authorize URL is valid for ${provider}` : 'Authorize URL is missing required params',
      data: {
        returnPath,
        redirectUri: parsed.searchParams.get('redirect_uri'),
        requiredScopes,
        scopeLooksComplete: scopeOk,
      },
      hint: ok ? 'Open Connect (OAuth) — sign in as the Google account with API access.' : undefined,
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
 * @param {object} report
 * @param {string} provider
 * @param {string} returnPath
 */
function buildOAuthTraceReport(report, provider, returnPath) {
  const firstFailure = report.stages.find((s) => !s.ok && !s.skipped) ?? null;
  const oauthVerdict = report.stages.find((s) => s.id === 'stored_connection');
  return {
    ...report,
    provider,
    returnPath,
    firstFailure,
    oauthLikelyComplete: oauthVerdict?.data?.hasAccessToken === true,
  };
}

/**
 * @param {object} payload
 */
function finalizeStagedReport(payload) {
  const { provider, businessId, startedAt, stages, message, ok: okOverride, extra = {} } = payload;
  const actionableStages = stages.filter((s) => !s.skipped);
  const ok =
    okOverride !== undefined
      ? okOverride
      : actionableStages.length > 0 && actionableStages.every((s) => s.ok);
  const firstFailure = stages.find((s) => !s.ok && !s.skipped) ?? null;

  return {
    provider,
    businessId,
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
    ...extra,
  };
}

module.exports = {
  stage,
  redactToken,
  traceTokenCrypto,
  traceBusinessContext,
  traceStoredConnection,
  traceConnectionStatus,
  traceTokenRefresh,
  traceConnectUrl,
  buildOAuthTraceReport,
  finalizeStagedReport,
};
