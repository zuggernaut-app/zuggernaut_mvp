'use strict';

const mongoose = require('mongoose');
const {
  getConnectionStatus,
  CONNECTION_REASON,
} = require('./integrationConnectionService');

const IntegrationConnection = mongoose.model('IntegrationConnection');

/**
 * @param {string | number | undefined} customerId
 */
function normalizeCustomerId(customerId) {
  if (customerId == null || customerId === '') return null;
  return String(customerId).replace(/-/g, '').trim();
}

class SetupReadyConnectionError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   * @param {{ provider?: string, reason?: string, identifiersMissing?: string[] }} [meta]
   */
  constructor(message, code = 'PROVIDER_NOT_SETUP_READY', meta = {}) {
    super(message);
    this.name = 'SetupReadyConnectionError';
    this.code = code;
    this.provider = meta.provider ?? null;
    this.reason = meta.reason ?? null;
    this.identifiersMissing = meta.identifiersMissing ?? [];
  }
}

/**
 * @param {object | null | undefined} ids
 */
function normalizeGtmIdentifiers(ids) {
  if (!ids?.accountId || !ids?.containerId || !ids?.workspaceId) {
    throw new SetupReadyConnectionError(
      'GTM accountId/containerId/workspaceId missing on IntegrationConnection.providerIdentifiers.',
      'GTM_MISSING_IDENTIFIERS',
      { provider: 'gtm' }
    );
  }
  return {
    accountId: String(ids.accountId),
    containerId: String(ids.containerId),
    workspaceId: String(ids.workspaceId),
    publicContainerId: ids.publicContainerId ?? ids.containerPublicId ?? ids.gtmId ?? null,
  };
}

/**
 * @param {string} provider
 * @param {{ ready: boolean, reason: string, identifiersMissing?: string[] }} status
 */
function resolveSetupReadyErrorCode(provider, status) {
  const missing = status.identifiersMissing ?? [];

  if (status.reason === CONNECTION_REASON.PROVISIONING_REQUIRED) {
    return provider === 'gtm' ? 'GTM_MISSING_IDENTIFIERS' : 'ADS_MISSING_CUSTOMER_ID';
  }
  if (status.reason === CONNECTION_REASON.MISSING_CONNECTION) {
    return provider === 'gtm' ? 'GTM_MISSING_CONNECTION' : 'ADS_MISSING_CONNECTION';
  }
  if (status.reason === CONNECTION_REASON.MISSING_TOKENS) {
    return provider === 'gtm' ? 'GTM_MISSING_CONNECTION' : 'ADS_MISSING_CONNECTION';
  }
  if (
    status.reason === CONNECTION_REASON.NEEDS_REAUTH ||
    status.reason === CONNECTION_REASON.TOKEN_EXPIRED
  ) {
    return provider === 'gtm' ? 'GTM_NEEDS_REAUTH' : 'ADS_NEEDS_REAUTH';
  }
  if (status.reason === CONNECTION_REASON.INSUFFICIENT_SCOPES) {
    return provider === 'gtm' ? 'GTM_INSUFFICIENT_SCOPES' : 'ADS_INSUFFICIENT_SCOPES';
  }
  if (missing.length > 0) {
    return provider === 'gtm' ? 'GTM_MISSING_IDENTIFIERS' : 'ADS_MISSING_CUSTOMER_ID';
  }
  return 'PROVIDER_NOT_SETUP_READY';
}

/**
 * @param {string} provider
 * @param {{ ready: boolean, reason: string, nextAction?: string | null, identifiersMissing?: string[] }} status
 */
function buildSetupReadyErrorMessage(provider, status) {
  if (status.reason === CONNECTION_REASON.PROVISIONING_REQUIRED) {
    return `Approve provisioning for ${provider} to create setup-ready resources before continuing.`;
  }
  if (status.reason === CONNECTION_REASON.MISSING_CONNECTION) {
    return `${provider} connection missing; connect before continuing.`;
  }
  if (status.reason === CONNECTION_REASON.NEEDS_REAUTH) {
    return `${provider} needs re-authentication before continuing.`;
  }
  if (status.reason === CONNECTION_REASON.INSUFFICIENT_SCOPES) {
    return `${provider} OAuth grant is missing required scopes; reconnect to continue.`;
  }
  return `Provider ${provider} is not setup-ready (${status.reason}).`;
}

/**
 * Loads a setup-ready IntegrationConnection and normalized provider identifiers.
 * Uses getConnectionStatus as the single readiness source of truth.
 *
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {'gtm' | 'google_ads'} provider
 * @param {{ selectTokens?: boolean, attemptRefresh?: boolean }} [opts]
 */
async function loadSetupReadyConnection(businessId, provider, opts = {}) {
  const { selectTokens = false, attemptRefresh = true } = opts;

  const status = await getConnectionStatus(businessId, provider, { attemptRefresh });
  if (!status.ready) {
    const code = resolveSetupReadyErrorCode(provider, status);
    throw new SetupReadyConnectionError(
      buildSetupReadyErrorMessage(provider, status),
      code,
      {
        provider,
        reason: status.reason,
        identifiersMissing: status.identifiersMissing ?? [],
      }
    );
  }

  const selectFields = selectTokens
    ? '+accessTokenEnc +refreshTokenEnc connectionHealth scopes tokenExpiryAt providerIdentifiers'
    : 'connectionHealth scopes tokenExpiryAt providerIdentifiers';

  const row = await IntegrationConnection.findOne({ businessId, provider })
    .select(selectFields)
    .lean();

  if (!row) {
    const code = provider === 'gtm' ? 'GTM_MISSING_CONNECTION' : 'ADS_MISSING_CONNECTION';
    throw new SetupReadyConnectionError(
      `${provider} connection missing; connect before continuing.`,
      code,
      { provider, reason: CONNECTION_REASON.MISSING_CONNECTION }
    );
  }

  const providerIdentifiers = row.providerIdentifiers ?? {};

  if (provider === 'gtm') {
    return {
      provider,
      status,
      connection: row,
      providerIdentifiers,
      gtmIds: normalizeGtmIdentifiers(providerIdentifiers),
    };
  }

  const customerId = normalizeCustomerId(providerIdentifiers.customerId);
  if (!customerId) {
    throw new SetupReadyConnectionError(
      'Google Ads customerId missing on IntegrationConnection.providerIdentifiers.',
      'ADS_MISSING_CUSTOMER_ID',
      { provider, reason: CONNECTION_REASON.PROVISIONING_REQUIRED }
    );
  }

  const loginCustomerId = normalizeCustomerId(providerIdentifiers.loginCustomerId);

  return {
    provider,
    status,
    connection: row,
    providerIdentifiers,
    customerId,
    loginCustomerId: loginCustomerId ?? null,
  };
}

/**
 * @template {typeof Error} T
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {'gtm' | 'google_ads'} provider
 * @param {new (message: string, code?: string) => T} ErrorClass
 * @param {{ selectTokens?: boolean, attemptRefresh?: boolean }} [opts]
 */
async function requireSetupReadyConnection(businessId, provider, ErrorClass, opts = {}) {
  try {
    return await loadSetupReadyConnection(businessId, provider, opts);
  } catch (err) {
    if (err instanceof SetupReadyConnectionError) {
      throw new ErrorClass(err.message, err.code);
    }
    throw err;
  }
}

/** @deprecated Use normalizeGtmIdentifiers */
const validateGtmIdentifiers = normalizeGtmIdentifiers;

module.exports = {
  SetupReadyConnectionError,
  normalizeGtmIdentifiers,
  normalizeCustomerId,
  validateGtmIdentifiers,
  loadSetupReadyConnection,
  requireSetupReadyConnection,
  resolveSetupReadyErrorCode,
};
