'use strict';

const mongoose = require('mongoose');
const { PROVIDERS } = require('../../constants/enums');
const {
  validateGrantedScopes,
  getGoogleProviderOAuthConfig,
} = require('../../constants/googleOAuth');
const { REQUIRED_PROVIDER_IDENTIFIER_KEYS } = require('../../constants/provisioning');
const {
  hasRequiredIdentifiers,
  getMissingIdentifierKeys,
} = require('../integrations/providerDiscoveryResult');
const { getFreshGoogleAccessToken, REFRESH_BUFFER_MS } = require('../integrations/googleTokenService');

const IntegrationConnection = mongoose.model('IntegrationConnection');

/** Stable reason codes for workflow/UI (no secrets). */
const CONNECTION_REASON = Object.freeze({
  OK: 'ok',
  MISSING_CONNECTION: 'missing_connection',
  NOT_CONNECTED: 'not_connected',
  MISSING_TOKENS: 'missing_tokens',
  TOKEN_EXPIRED: 'token_expired',
  INSUFFICIENT_SCOPES: 'insufficient_scopes',
  NEEDS_REAUTH: 'needs_reauth',
  PROVISIONING_REQUIRED: 'provisioning_required',
  SELECTION_REQUIRED: 'selection_required',
});

const REQUIRED_FOR_SETUP = Object.freeze(['gtm', 'google_ads']);

/** @deprecated Use REQUIRED_PROVIDER_IDENTIFIER_KEYS from constants/provisioning.js */
const REQUIRED_PROVIDER_IDENTIFIERS = REQUIRED_PROVIDER_IDENTIFIER_KEYS;

function safeProviderIdentifiers(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = { ...raw };
  for (const key of Object.keys(out)) {
    if (/token|secret|password|enc/i.test(key)) delete out[key];
  }
  return out;
}

/**
 * @param {string} provider
 */
function provisioningNextAction(provider) {
  if (provider === 'gtm') return 'approve_gtm_provisioning';
  if (provider === 'google_ads') return 'approve_google_ads_provisioning';
  return `provision_${provider}`;
}

/**
 * @param {string} provider
 */
function selectionNextAction(provider) {
  if (provider === 'google_ads') return 'select_google_ads_customer';
  if (provider === 'gtm') return 'select_gtm_container';
  return `select_${provider}_resource`;
}

/**
 * @param {object} base
 * @param {string} provider
 * @param {object | null | undefined} identifiers
 */
function buildProvisioningRequiredStatus(base, provider, identifiers) {
  return {
    ...base,
    ready: false,
    reason: CONNECTION_REASON.PROVISIONING_REQUIRED,
    nextAction: provisioningNextAction(provider),
    identifiersMissing: getMissingIdentifierKeys(provider, identifiers),
  };
}

/**
 * @param {object} base
 * @param {string} provider
 * @param {object | null | undefined} identifiers
 */
function buildSelectionRequiredStatus(base, provider, identifiers) {
  return {
    ...base,
    ready: false,
    reason: CONNECTION_REASON.SELECTION_REQUIRED,
    nextAction: selectionNextAction(provider),
    identifiersMissing: getMissingIdentifierKeys(provider, identifiers),
  };
}

/**
 * @param {object} base
 * @param {string} provider
 * @param {{ connectionHealth?: string | null, providerIdentifiers?: object | null }} row
 */
function resolveIdentifierReadinessStatus(base, provider, row) {
  if (
    row.connectionHealth === 'selection_required' &&
    !hasRequiredIdentifiers(provider, row.providerIdentifiers)
  ) {
    return buildSelectionRequiredStatus(base, provider, row.providerIdentifiers);
  }

  if (!hasRequiredIdentifiers(provider, row.providerIdentifiers)) {
    return buildProvisioningRequiredStatus(base, provider, row.providerIdentifiers);
  }

  return {
    ...base,
    ready: true,
    reason: CONNECTION_REASON.OK,
    nextAction: null,
    identifiersMissing: [],
  };
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {string} provider
 * @param {{ attemptRefresh?: boolean }} [opts]
 */
async function getConnectionStatus(businessId, provider, opts = {}) {
  const { attemptRefresh = false } = opts;
  const emptyIdentifiers = [];

  if (!PROVIDERS.includes(provider)) {
    return {
      provider,
      ready: false,
      reason: CONNECTION_REASON.NOT_CONNECTED,
      connectionHealth: null,
      nextAction: `connect_${provider}`,
      scopesGranted: [],
      scopesMissing: [],
      providerIdentifiers: null,
      identifiersMissing: emptyIdentifiers,
    };
  }

  const row = await IntegrationConnection.findOne({ businessId, provider })
    .select('+accessTokenEnc +refreshTokenEnc connectionHealth scopes tokenExpiryAt providerIdentifiers')
    .lean();

  if (!row) {
    return {
      provider,
      ready: false,
      reason: CONNECTION_REASON.MISSING_CONNECTION,
      connectionHealth: null,
      nextAction: `connect_${provider}`,
      scopesGranted: [],
      scopesMissing: [],
      providerIdentifiers: null,
      identifiersMissing: getMissingIdentifierKeys(provider, null),
    };
  }

  const cfg = getGoogleProviderOAuthConfig(provider);
  const granted = Array.isArray(row.scopes) ? row.scopes : [];
  const scopeCheck = cfg ? validateGrantedScopes(provider, granted) : { ok: true, missing: [] };

  const base = {
    provider,
    connectionHealth: row.connectionHealth ?? null,
    scopesGranted: granted,
    scopesMissing: scopeCheck.missing,
    providerIdentifiers: safeProviderIdentifiers(row.providerIdentifiers),
  };

  if (row.connectionHealth === 'needs_reauth') {
    return {
      ...base,
      ready: false,
      reason: CONNECTION_REASON.NEEDS_REAUTH,
      nextAction: `reconnect_${provider}`,
      identifiersMissing: emptyIdentifiers,
    };
  }

  const oauthHealthy =
    row.connectionHealth === 'connected' ||
    row.connectionHealth === 'provisioning_required' ||
    row.connectionHealth === 'selection_required';
  if (!oauthHealthy) {
    return {
      ...base,
      ready: false,
      reason: CONNECTION_REASON.NOT_CONNECTED,
      nextAction: `connect_${provider}`,
      identifiersMissing: emptyIdentifiers,
    };
  }

  if (!scopeCheck.ok) {
    return {
      ...base,
      ready: false,
      reason: CONNECTION_REASON.INSUFFICIENT_SCOPES,
      nextAction: `reconnect_${provider}`,
      identifiersMissing: emptyIdentifiers,
    };
  }

  if (!row.accessTokenEnc && !row.refreshTokenEnc) {
    return {
      ...base,
      ready: false,
      reason: CONNECTION_REASON.MISSING_TOKENS,
      nextAction: `connect_${provider}`,
      identifiersMissing: emptyIdentifiers,
    };
  }

  const expired =
    row.tokenExpiryAt && row.tokenExpiryAt.getTime() < Date.now() + REFRESH_BUFFER_MS;

  if (expired && row.refreshTokenEnc) {
    if (attemptRefresh) {
      try {
        await getFreshGoogleAccessToken({ businessId, provider });
      } catch {
        return {
          ...base,
          ready: false,
          reason: CONNECTION_REASON.NEEDS_REAUTH,
          nextAction: `reconnect_${provider}`,
          identifiersMissing: emptyIdentifiers,
        };
      }
    }
    return resolveIdentifierReadinessStatus(base, provider, row);
  }

  if (expired) {
    return {
      ...base,
      ready: false,
      reason: CONNECTION_REASON.TOKEN_EXPIRED,
      nextAction: `reconnect_${provider}`,
      identifiersMissing: emptyIdentifiers,
    };
  }

  return resolveIdentifierReadinessStatus(base, provider, row);
}

/**
 * OAuth health only — does not require provider identifiers (customer/container IDs).
 *
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {string} provider
 * @param {{ attemptRefresh?: boolean }} [opts]
 */
async function getOAuthConnectionStatus(businessId, provider, opts = {}) {
  const status = await getConnectionStatus(businessId, provider, opts);
  const oauthFailureReasons = new Set([
    CONNECTION_REASON.MISSING_CONNECTION,
    CONNECTION_REASON.NOT_CONNECTED,
    CONNECTION_REASON.MISSING_TOKENS,
    CONNECTION_REASON.NEEDS_REAUTH,
    CONNECTION_REASON.INSUFFICIENT_SCOPES,
    CONNECTION_REASON.TOKEN_EXPIRED,
  ]);

  return {
    ...status,
    oauthReady: !oauthFailureReasons.has(status.reason),
    identifiersReady: status.ready,
  };
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {readonly string[]} [providers]
 */
async function getAllConnectionStatuses(businessId, providers = PROVIDERS) {
  const out = {};
  for (const p of providers) {
    out[p] = await getConnectionStatus(businessId, p);
  }
  return out;
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function getRequiredSetupConnections(businessId) {
  const statuses = {};
  const missing = [];
  for (const p of REQUIRED_FOR_SETUP) {
    const s = await getConnectionStatus(businessId, p);
    statuses[p] = s;
    if (!s.ready) missing.push(p);
  }
  return { statuses, missing, allReady: missing.length === 0 };
}

/**
 * @param {{ ready: boolean, reason: string, provider: string }} status
 */
function assertConnectionReady(status) {
  if (status.ready) return;
  const hint =
    status.reason === CONNECTION_REASON.PROVISIONING_REQUIRED
      ? `Approve provisioning for ${status.provider} to create setup-ready resources before continuing.`
      : `Connect ${status.provider} before continuing.`;
  const err = new Error(`Provider ${status.provider} is not ready (${status.reason}). ${hint}`);
  err.code = 'PROVIDER_NOT_READY';
  err.provider = status.provider;
  err.reason = status.reason;
  throw err;
}

module.exports = {
  CONNECTION_REASON,
  REQUIRED_FOR_SETUP,
  REQUIRED_PROVIDER_IDENTIFIERS,
  getConnectionStatus,
  getOAuthConnectionStatus,
  getAllConnectionStatuses,
  getRequiredSetupConnections,
  assertConnectionReady,
  safeProviderIdentifiers,
};
