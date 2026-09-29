'use strict';

const mongoose = require('mongoose');
const { PROVISIONING_ACTIVE_STATUSES } = require('../../constants/enums');
const { DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER } = require('../../constants/provisioning');
const {
  getConnectionStatus,
  CONNECTION_REASON,
  safeProviderIdentifiers,
} = require('./integrationConnectionService');
const { resolveSetupUserErrorMessage } = require('../../lib/setupUserErrorMessages');
const { provisionGtmResources, GtmProvisioningError } = require('./gtmProvisioningService');
const {
  provisionGoogleAdsCustomer,
  AdsProvisioningError,
} = require('./adsProvisioningService');

const IntegrationProvisioningRequest = mongoose.model('IntegrationProvisioningRequest');
const SetupRun = mongoose.model('SetupRun');
const BusinessContext = mongoose.model('BusinessContext');

const PROVISIONING_PROVIDERS = Object.freeze(['gtm', 'google_ads']);

class ProvisioningServiceError extends Error {
  constructor(message, code = 'PROVISIONING_ERROR') {
    super(message);
    this.name = 'ProvisioningServiceError';
    this.code = code;
  }
}

/**
 * @param {string} provider
 */
function assertProvisioningProvider(provider) {
  if (!PROVISIONING_PROVIDERS.includes(provider)) {
    throw new ProvisioningServiceError(
      `Provisioning is not supported for provider: ${provider}`,
      'PROVISIONING_PROVIDER_UNSUPPORTED'
    );
  }
}

/**
 * @param {object | null | undefined} doc
 */
function serializeProvisioningRequest(doc) {
  if (!doc) return null;
  return {
    id: doc._id.toString(),
    businessId: doc.businessId.toString(),
    provider: doc.provider,
    status: doc.status,
    requestedResources: doc.requestedResources ?? [],
    approvedAt: doc.approvedAt ?? null,
    createdProviderIdentifiers: safeProviderIdentifiers(doc.createdProviderIdentifiers),
    errorCode: doc.errorCode ?? null,
    errorMessage: doc.errorCode
      ? resolveSetupUserErrorMessage({
          errorCode: doc.errorCode,
          fallbackMessage: doc.errorMessage ?? null,
        })
      : doc.errorMessage ?? null,
    setupRunId: doc.setupRunId ? doc.setupRunId.toString() : null,
    currencyCode: doc.currencyCode ?? null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * @param {string | null | undefined} currencyCode
 */
function normalizeProvisioningCurrencyCode(currencyCode) {
  const normalized = String(currencyCode ?? '').trim().toUpperCase();
  if (!normalized) return null;
  if (normalized !== 'USD' && normalized !== 'INR') {
    throw new ProvisioningServiceError(
      'currencyCode must be USD or INR.',
      'PROVISIONING_INVALID_CURRENCY'
    );
  }
  return normalized;
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {string} provider
 */
async function findActiveProvisioningRequest(businessId, provider) {
  return IntegrationProvisioningRequest.findOne({
    businessId,
    provider,
    status: { $in: PROVISIONING_ACTIVE_STATUSES },
  })
    .sort({ createdAt: -1 })
    .lean();
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {string} provider
 */
async function findLatestProvisioningRequest(businessId, provider) {
  return IntegrationProvisioningRequest.findOne({ businessId, provider })
    .sort({ createdAt: -1 })
    .lean();
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {string} provider
 */
async function getProviderProvisioningState(businessId, provider) {
  assertProvisioningProvider(provider);
  const connection = await getConnectionStatus(businessId, provider);
  const activeRequest = await findActiveProvisioningRequest(businessId, provider);
  const latestRequest =
    activeRequest ?? (await findLatestProvisioningRequest(businessId, provider));

  return {
    provider,
    connection,
    activeRequest: serializeProvisioningRequest(activeRequest),
    latestRequest: serializeProvisioningRequest(latestRequest),
    provisioningRequired: connection.reason === CONNECTION_REASON.PROVISIONING_REQUIRED,
  };
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function getProvisioningOverview(businessId) {
  const providers = {};
  for (const provider of PROVISIONING_PROVIDERS) {
    providers[provider] = await getProviderProvisioningState(businessId, provider);
  }
  return { businessId: businessId.toString(), providers };
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {string} provider
 */
async function assertProvisioningEligible(businessId, provider) {
  const connection = await getConnectionStatus(businessId, provider);

  if (connection.reason === CONNECTION_REASON.MISSING_CONNECTION) {
    throw new ProvisioningServiceError(
      `Connect ${provider} before requesting provisioning.`,
      'PROVISIONING_CONNECTION_REQUIRED'
    );
  }

  if (
    connection.reason === CONNECTION_REASON.NEEDS_REAUTH ||
    connection.reason === CONNECTION_REASON.INSUFFICIENT_SCOPES ||
    connection.reason === CONNECTION_REASON.MISSING_TOKENS ||
    connection.reason === CONNECTION_REASON.TOKEN_EXPIRED
  ) {
    throw new ProvisioningServiceError(
      `Fix ${provider} connection (${connection.reason}) before requesting provisioning.`,
      'PROVISIONING_CONNECTION_NOT_READY'
    );
  }

  if (connection.ready) {
    throw new ProvisioningServiceError(
      `${provider} is already setup-ready; provisioning is not required.`,
      'PROVISIONING_NOT_REQUIRED'
    );
  }

  if (connection.reason !== CONNECTION_REASON.PROVISIONING_REQUIRED) {
    throw new ProvisioningServiceError(
      `${provider} is not eligible for provisioning (${connection.reason}).`,
      'PROVISIONING_NOT_ELIGIBLE'
    );
  }

  return connection;
}

/**
 * @param {object} input
 * @param {import('mongoose').Types.ObjectId | string} input.businessId
 * @param {string} input.provider
 * @param {import('mongoose').Types.ObjectId | string} input.requestedByUserId
 * @param {import('mongoose').Types.ObjectId | string | null | undefined} [input.setupRunId]
 */
async function createProvisioningRequest(input) {
  const { businessId, provider, requestedByUserId, setupRunId, currencyCode } = input;
  assertProvisioningProvider(provider);
  await assertProvisioningEligible(businessId, provider);
  const normalizedCurrency = normalizeProvisioningCurrencyCode(currencyCode);

  const existing = await findActiveProvisioningRequest(businessId, provider);
  if (existing) {
    const updates = {};
    if (setupRunId && String(existing.setupRunId ?? '') !== String(setupRunId)) {
      updates.setupRunId = setupRunId;
    }
    if (normalizedCurrency) {
      updates.currencyCode = normalizedCurrency;
    }
    if (Object.keys(updates).length > 0) {
      await IntegrationProvisioningRequest.findByIdAndUpdate(existing._id, { $set: updates });
    }
    return {
      request: serializeProvisioningRequest({
        ...existing,
        setupRunId: setupRunId ?? existing.setupRunId,
        currencyCode: normalizedCurrency ?? existing.currencyCode,
      }),
      created: false,
    };
  }

  if (setupRunId) {
    await assertSetupRunForBusiness(setupRunId, businessId);
  }

  const requestedResources = DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER[provider];
  const request = await IntegrationProvisioningRequest.create({
    businessId,
    provider,
    requestedResources,
    requestedByUserId,
    setupRunId: setupRunId ?? null,
    status: 'pending_approval',
    ...(normalizedCurrency ? { currencyCode: normalizedCurrency } : {}),
  });

  return { request: serializeProvisioningRequest(request.toObject()), created: true };
}

/**
 * @param {import('mongoose').Types.ObjectId | string} setupRunId
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function assertSetupRunForBusiness(setupRunId, businessId) {
  if (!setupRunId || !mongoose.Types.ObjectId.isValid(String(setupRunId))) {
    throw new ProvisioningServiceError('setupRunId must be a valid ObjectId.', 'PROVISIONING_INVALID_SETUP_RUN');
  }
  const run = await SetupRun.findById(setupRunId).select('businessId').lean();
  if (!run || String(run.businessId) !== String(businessId)) {
    throw new ProvisioningServiceError('Setup run not found for this business.', 'PROVISIONING_SETUP_RUN_NOT_FOUND');
  }
}

/**
 * @param {object} input
 * @param {import('mongoose').Types.ObjectId | string} input.requestId
 * @param {import('mongoose').Types.ObjectId | string} input.businessId
 * @param {import('mongoose').Types.ObjectId | string} input.approvedByUserId
 */
async function approveProvisioningRequest(input) {
  const { requestId, businessId, approvedByUserId, provisioningIntent, currencyCode } = input;
  const request = await loadOwnedProvisioningRequest(requestId, businessId);
  const normalizedCurrency = normalizeProvisioningCurrencyCode(currencyCode);

  if (request.status !== 'pending_approval') {
    throw new ProvisioningServiceError(
      `Provisioning request cannot be approved from status ${request.status}.`,
      'PROVISIONING_INVALID_STATUS'
    );
  }

  if (request.provider === 'google_ads' && provisioningIntent === 'mcc_create') {
    const { saveGoogleAdsProvisioningIntent } = require('../integrations/googleAdsResourceSelectionService');
    await saveGoogleAdsProvisioningIntent(businessId);
  }

  const approvedAt = new Date();
  const updated = await IntegrationProvisioningRequest.findByIdAndUpdate(
    request._id,
    {
      $set: {
        status: 'approved',
        approvedByUserId,
        approvedAt,
        ...(normalizedCurrency ? { currencyCode: normalizedCurrency } : {}),
      },
    },
    { new: true }
  ).lean();

  return serializeProvisioningRequest(updated);
}

/**
 * @param {object} input
 * @param {import('mongoose').Types.ObjectId | string} input.requestId
 * @param {import('mongoose').Types.ObjectId | string} input.businessId
 * @param {import('mongoose').Types.ObjectId | string} input.setupRunId
 * @param {import('pino').Logger} [input.logger]
 */
async function executeProvisioningRequest(input) {
  const { requestId, businessId, setupRunId, logger } = input;
  const request = await loadOwnedProvisioningRequest(requestId, businessId);
  await assertSetupRunForBusiness(setupRunId, businessId);

  if (request.status !== 'approved') {
    throw new ProvisioningServiceError(
      `Provisioning request must be approved before execution (status: ${request.status}).`,
      'PROVISIONING_APPROVAL_REQUIRED'
    );
  }

  if (request.provider === 'gtm') {
    return provisionGtmResources({
      businessId,
      setupRunId,
      provisioningRequestId: request._id,
      logger,
    });
  }

  if (request.provider === 'google_ads') {
    return provisionGoogleAdsCustomer({
      businessId,
      setupRunId,
      provisioningRequestId: request._id,
      currencyCode: request.currencyCode,
      logger,
    });
  }

  throw new ProvisioningServiceError(
    `Provisioning execution is not supported for provider: ${request.provider}`,
    'PROVISIONING_PROVIDER_UNSUPPORTED'
  );
}

/**
 * @param {object} input
 * @param {import('mongoose').Types.ObjectId | string} input.requestId
 * @param {import('mongoose').Types.ObjectId | string} input.businessId
 */
async function cancelProvisioningRequest(input) {
  const { requestId, businessId } = input;
  const request = await loadOwnedProvisioningRequest(requestId, businessId);

  if (request.status !== 'pending_approval') {
    throw new ProvisioningServiceError(
      `Only pending approval requests can be cancelled (status: ${request.status}).`,
      'PROVISIONING_INVALID_STATUS'
    );
  }

  const updated = await IntegrationProvisioningRequest.findByIdAndUpdate(
    request._id,
    { $set: { status: 'cancelled' } },
    { new: true }
  ).lean();

  return serializeProvisioningRequest(updated);
}

/**
 * @param {import('mongoose').Types.ObjectId | string} requestId
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function loadOwnedProvisioningRequest(requestId, businessId) {
  if (!requestId || !mongoose.Types.ObjectId.isValid(String(requestId))) {
    throw new ProvisioningServiceError('Invalid provisioning request id.', 'PROVISIONING_REQUEST_NOT_FOUND');
  }

  const request = await IntegrationProvisioningRequest.findById(requestId).lean();
  if (!request || String(request.businessId) !== String(businessId)) {
    throw new ProvisioningServiceError('Provisioning request not found.', 'PROVISIONING_REQUEST_NOT_FOUND');
  }

  return request;
}

/**
 * @param {import('mongoose').Types.ObjectId | string} userId
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function assertUserOwnsBusiness(userId, businessId) {
  const exists = await BusinessContext.exists({
    businessId,
    userId: new mongoose.Types.ObjectId(String(userId)),
  });
  if (!exists) {
    throw new ProvisioningServiceError('Business context not found for this user.', 'PROVISIONING_BUSINESS_NOT_FOUND');
  }
}

/**
 * Idempotently ensure an active provisioning request exists for a setup run.
 *
 * @param {object} input
 * @param {import('mongoose').Types.ObjectId | string} input.businessId
 * @param {string} input.provider
 * @param {import('mongoose').Types.ObjectId | string} input.setupRunId
 */
async function ensureSetupProvisioningRequest(input) {
  const { businessId, provider, setupRunId } = input;
  const bc = await BusinessContext.findOne({ businessId }).select('userId').lean();
  return createProvisioningRequest({
    businessId,
    provider,
    setupRunId,
    requestedByUserId: bc?.userId ?? null,
  });
}

/**
 * @param {object} input
 * @param {import('mongoose').Types.ObjectId | string} input.businessId
 * @param {string} input.provider
 */
async function checkSetupProvisioningApproval(input) {
  const { businessId, provider } = input;
  assertProvisioningProvider(provider);

  const connection = await getConnectionStatus(businessId, provider);
  if (connection.ready) {
    return { outcome: 'ready', connection, request: null, provisioningRequestId: null };
  }

  const active = await findActiveProvisioningRequest(businessId, provider);
  const latest = active ?? (await findLatestProvisioningRequest(businessId, provider));
  if (!latest) {
    return { outcome: 'no_request', connection, request: null, provisioningRequestId: null };
  }

  const request = serializeProvisioningRequest(latest);
  if (latest.status === 'pending_approval') {
    return { outcome: 'pending_approval', connection, request, provisioningRequestId: request.id };
  }
  if (latest.status === 'approved') {
    return { outcome: 'approved', connection, request, provisioningRequestId: request.id };
  }
  if (latest.status === 'provisioning') {
    return { outcome: 'provisioning', connection, request, provisioningRequestId: request.id };
  }
  if (latest.status === 'failed' || latest.status === 'cancelled') {
    return { outcome: 'terminal_failure', connection, request, provisioningRequestId: request.id };
  }
  if (latest.status === 'provisioned') {
    if (connection.ready) {
      return { outcome: 'ready', connection, request, provisioningRequestId: request.id };
    }
    return { outcome: 'manual_review', connection, request, provisioningRequestId: request.id };
  }

  return { outcome: 'manual_review', connection, request, provisioningRequestId: request.id };
}

module.exports = {
  PROVISIONING_PROVIDERS,
  ProvisioningServiceError,
  GtmProvisioningError,
  AdsProvisioningError,
  getProvisioningOverview,
  getProviderProvisioningState,
  createProvisioningRequest,
  ensureSetupProvisioningRequest,
  checkSetupProvisioningApproval,
  approveProvisioningRequest,
  executeProvisioningRequest,
  cancelProvisioningRequest,
  serializeProvisioningRequest,
  assertUserOwnsBusiness,
};
