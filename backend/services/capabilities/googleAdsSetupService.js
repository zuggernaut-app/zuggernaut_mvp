'use strict';

const mongoose = require('mongoose');
const { SETUP_STEP_NAMES } = require('../../constants/setupWorkflow');
const {
  getOAuthConnectionStatus,
  CONNECTION_REASON,
} = require('./integrationConnectionService');
const {
  ensureSetupProvisioningRequest,
  checkSetupProvisioningApproval,
} = require('./integrationProvisioningService');
const { listAccessibleCustomers, getEffectiveAdsDiscoveryReason } = require('../integrations/googleAdsAccountClient');
const { getFreshGoogleAccessToken } = require('../integrations/googleTokenService');
const {
  getGoogleAdsLoginCustomerId,
  GoogleAdsAccountError,
  normalizeCustomerId,
} = require('../integrations/googleAdsApiConfig');
const { hasRequiredIdentifiers } = require('../integrations/providerDiscoveryResult');

const IntegrationConnection = mongoose.model('IntegrationConnection');

class GoogleAdsSetupError extends Error {
  /**
   * @param {string} message
   * @param {string} [code]
   * @param {Record<string, unknown>} [details]
   */
  constructor(message, code = 'GOOGLE_ADS_SETUP_ERROR', details = undefined) {
    super(message);
    this.name = 'GoogleAdsSetupError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

/**
 * OAuth-only Google Ads connection check — does not call Google Ads API.
 *
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {{ attemptRefresh?: boolean }} [opts]
 */
async function verifyGoogleAdsOAuthConnection(businessId, opts = {}) {
  return getOAuthConnectionStatus(businessId, 'google_ads', opts);
}

/**
 * Discover accessible Google Ads customers and persist on IntegrationConnection.
 *
 * @param {object} input
 * @param {import('mongoose').Types.ObjectId | string} input.businessId
 * @param {import('mongoose').Types.ObjectId | string} [input.setupRunId]
 * @param {import('pino').Logger} [input.logger]
 */
async function discoverAndPersistGoogleAdsCustomers(input) {
  const { businessId, setupRunId, logger } = input;
  const accessToken = await getFreshGoogleAccessToken({ businessId, provider: 'google_ads' });

  try {
    const existing = await IntegrationConnection.findOne({ businessId, provider: 'google_ads' })
      .select('providerIdentifiers')
      .lean();
    const priorIdentifiers = existing?.providerIdentifiers ?? {};

    const customerIds = await listAccessibleCustomers(accessToken);
    const loginCustomerId = getGoogleAdsLoginCustomerId();
    const recordedAt = new Date().toISOString();
    const savedCustomerId = normalizeCustomerId(priorIdentifiers.customerId);

    if (
      savedCustomerId &&
      customerIds.map(String).includes(savedCustomerId) &&
      hasRequiredIdentifiers('google_ads', priorIdentifiers)
    ) {
      const providerIdentifiers = {
        ...priorIdentifiers,
        customerId: savedCustomerId,
        accessibleCustomerIds: customerIds,
        ...(loginCustomerId ? { loginCustomerId, managerCustomerId: loginCustomerId } : {}),
        discoveryRecordedAt: recordedAt,
        discoverySource: setupRunId ? 'setup_workflow' : 'diagnostics',
        selectionRequired: false,
      };

      await IntegrationConnection.findOneAndUpdate(
        { businessId, provider: 'google_ads' },
        {
          $set: {
            connectionHealth: 'connected',
            providerIdentifiers,
          },
        }
      );

      logger?.info?.(
        {
          businessId: String(businessId),
          setupRunId: setupRunId ? String(setupRunId) : null,
          customerId: savedCustomerId,
          accessibleCount: customerIds.length,
          connectionHealth: 'connected',
        },
        'google ads customer discovery reused saved selection'
      );

      return {
        outcome: 'ok',
        customerId: savedCustomerId,
        accessibleCustomerIds: customerIds,
        providerIdentifiers,
      };
    }

    const providerIdentifiers = {
      ...(customerIds.length > 0
        ? {
            accessibleCustomerIds: customerIds,
          }
        : {
            accessibleCustomerIds: [],
            discoveryReason: 'ADS_CUSTOMER_NOT_FOUND',
          }),
      ...(loginCustomerId ? { loginCustomerId, managerCustomerId: loginCustomerId } : {}),
      discoveryRecordedAt: recordedAt,
      discoverySource: setupRunId ? 'setup_workflow' : 'diagnostics',
    };

    const emptyCustomerReason =
      customerIds.length === 0
        ? getEffectiveAdsDiscoveryReason(providerIdentifiers)
        : null;
    const connectionHealth =
      customerIds.length > 0
        ? 'selection_required'
        : emptyCustomerReason === 'ADS_PROVISIONING_REQUIRED'
          ? 'provisioning_required'
          : 'connected';

    await IntegrationConnection.findOneAndUpdate(
      { businessId, provider: 'google_ads' },
      {
        $set: {
          connectionHealth,
          providerIdentifiers: {
            ...providerIdentifiers,
            ...(customerIds.length > 0 ? { selectionRequired: true } : {}),
          },
        },
      }
    );

    logger?.info?.(
      {
        businessId: String(businessId),
        setupRunId: setupRunId ? String(setupRunId) : null,
        accessibleCount: customerIds.length,
        connectionHealth,
      },
      'google ads customer discovery persisted'
    );

    if (customerIds.length === 0) {
      if (emptyCustomerReason === 'ADS_CUSTOMER_NOT_FOUND') {
        return {
          outcome: 'customer_not_found',
          accessibleCustomerIds: [],
          customerId: null,
          providerIdentifiers,
        };
      }

      return {
        outcome: 'provisioning_required',
        accessibleCustomerIds: [],
        customerId: null,
        providerIdentifiers,
      };
    }

    return {
      outcome: 'selection_required',
      customerId: null,
      accessibleCustomerIds: customerIds,
      providerIdentifiers,
    };
  } catch (err) {
    const code =
      err instanceof GoogleAdsAccountError || err instanceof GoogleAdsSetupError
        ? err.code
        : typeof err.code === 'string'
          ? err.code
          : 'ADS_DISCOVERY_FAILED';
    const googleAdsError = err instanceof GoogleAdsAccountError ? err.details ?? null : null;

    logger?.warn?.(
      {
        businessId: String(businessId),
        setupRunId: setupRunId ? String(setupRunId) : null,
        code,
        googleAdsError,
      },
      'google ads customer discovery failed'
    );

    throw new GoogleAdsSetupError(
      err instanceof Error ? err.message : 'Google Ads customer discovery failed.',
      code,
      { googleAdsError, action: 'listAccessibleCustomers' }
    );
  }
}

/**
 * Ensure Ads provisioning approval exists when customer discovery requires provisioning.
 *
 * @param {object} input
 * @param {import('mongoose').Types.ObjectId | string} input.businessId
 * @param {import('mongoose').Types.ObjectId | string} input.setupRunId
 */
async function ensureGoogleAdsProvisioningApproval(input) {
  const { businessId, setupRunId } = input;
  const connection = await IntegrationConnection.findOne({ businessId, provider: 'google_ads' })
    .select('providerIdentifiers connectionHealth')
    .lean();

  if (hasRequiredIdentifiers('google_ads', connection?.providerIdentifiers)) {
    return {
      outcome: 'ready',
      provisioningRequestId: null,
      connection,
    };
  }

  const approvalCheck = await checkSetupProvisioningApproval({ businessId, provider: 'google_ads' });
  if (approvalCheck.outcome === 'ready') {
    return {
      outcome: 'ready',
      provisioningRequestId: approvalCheck.provisioningRequestId,
      connection: approvalCheck.connection,
    };
  }

  if (approvalCheck.outcome === 'pending_approval') {
    return {
      outcome: 'pending_approval',
      provisioningRequestId: approvalCheck.provisioningRequestId,
      connection: approvalCheck.connection,
      request: approvalCheck.request,
    };
  }

  if (approvalCheck.outcome === 'approved') {
    return {
      outcome: 'approved',
      provisioningRequestId: approvalCheck.provisioningRequestId,
      connection: approvalCheck.connection,
      request: approvalCheck.request,
    };
  }

  if (approvalCheck.outcome === 'no_request') {
    const { request } = await ensureSetupProvisioningRequest({
      businessId,
      provider: 'google_ads',
      setupRunId,
    });
    return {
      outcome: 'pending_approval',
      provisioningRequestId: request.id,
      connection: approvalCheck.connection,
      request,
      createdRequest: true,
    };
  }

  return {
    outcome:
      approvalCheck.outcome === 'terminal_failure' || approvalCheck.outcome === 'manual_review'
        ? 'manual_review'
        : approvalCheck.outcome,
    provisioningRequestId: approvalCheck.provisioningRequestId,
    connection: approvalCheck.connection,
    request: approvalCheck.request,
    reason: approvalCheck.outcome,
  };
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function assertGoogleAdsSetupReady(businessId) {
  const status = await verifyGoogleAdsOAuthConnection(businessId);
  if (!status.oauthReady) {
    throw new GoogleAdsSetupError(
      `Google Ads OAuth is not ready (${status.reason}).`,
      'GOOGLE_ADS_OAUTH_NOT_READY',
      { reason: status.reason }
    );
  }

  const conn = await IntegrationConnection.findOne({ businessId, provider: 'google_ads' })
    .select('providerIdentifiers')
    .lean();

  if (!hasRequiredIdentifiers('google_ads', conn?.providerIdentifiers)) {
    throw new GoogleAdsSetupError(
      'Google Ads customer identifiers are missing after setup.',
      'GOOGLE_ADS_IDENTIFIERS_MISSING'
    );
  }

  return conn.providerIdentifiers;
}

module.exports = {
  GoogleAdsSetupError,
  SETUP_STEP_NAMES,
  CONNECTION_REASON,
  verifyGoogleAdsOAuthConnection,
  discoverAndPersistGoogleAdsCustomers,
  ensureGoogleAdsProvisioningApproval,
  assertGoogleAdsSetupReady,
};
