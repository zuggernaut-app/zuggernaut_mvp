'use strict';

const mongoose = require('mongoose');
const { DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER } = require('../../constants/provisioning');
const { adsProvisioningIdempotencyKey } = require('../../constants/idempotency');
const {
  createCustomerClient,
  getGoogleAdsLoginCustomerId,
  normalizeCustomerId,
  GoogleAdsAccountError,
} = require('../integrations/googleAdsAccountClient');
const { getMccGoogleAdsAccessToken } = require('../integrations/googleTokenService');
const { hasRequiredIdentifiers } = require('../integrations/providerDiscoveryResult');
const { buildNewlyCreatedUnderMccLink } = require('./googleAdsMccLinkService');
const { maybeInjectFailure } = require('../../lib/qaFailureInjection');

const IntegrationConnection = mongoose.model('IntegrationConnection');
const IntegrationArtifact = mongoose.model('IntegrationArtifact');
const IntegrationProvisioningRequest = mongoose.model('IntegrationProvisioningRequest');
const BusinessContext = mongoose.model('BusinessContext');

class AdsProvisioningError extends Error {
  constructor(message, code = 'ADS_PROVISIONING_ERROR') {
    super(message);
    this.name = 'AdsProvisioningError';
    this.code = code;
  }
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {import('mongoose').Types.ObjectId | string} setupRunId
 */
function provisioningArtifactIdempotencyKey(businessId, setupRunId) {
  return adsProvisioningIdempotencyKey(businessId, setupRunId);
}

/**
 * @param {object} ctx
 */
async function findProvisioningArtifact(ctx) {
  const { businessId, setupRunId } = ctx;
  return IntegrationArtifact.findOne({
    businessId,
    setupRunId,
    provider: 'google_ads',
    idempotencyKey: provisioningArtifactIdempotencyKey(businessId, setupRunId),
  }).lean();
}

/**
 * @param {object} ctx
 */
async function persistProvisioningArtifact(ctx) {
  const { businessId, setupRunId, externalId, metadata } = ctx;
  await IntegrationArtifact.findOneAndUpdate(
    {
      businessId,
      setupRunId,
      provider: 'google_ads',
      artifactType: 'ads_customer',
      externalId,
    },
    {
      $setOnInsert: {
        idempotencyKey: provisioningArtifactIdempotencyKey(businessId, setupRunId),
      },
      $set: { metadata },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

/**
 * @param {object} request
 */
function assertApprovedAdsProvisioningRequest(request) {
  if (!request) {
    throw new AdsProvisioningError('Ads provisioning request not found.', 'ADS_PROVISIONING_REQUEST_NOT_FOUND');
  }
  if (request.provider !== 'google_ads') {
    throw new AdsProvisioningError('Provisioning request is not for Google Ads.', 'ADS_PROVISIONING_INVALID_PROVIDER');
  }
  if (request.status !== 'approved') {
    throw new AdsProvisioningError(
      'Google Ads provisioning requires an approved consent request.',
      'ADS_PROVISIONING_APPROVAL_REQUIRED'
    );
  }
  if (!request.approvedByUserId || !request.approvedAt) {
    throw new AdsProvisioningError(
      'Google Ads provisioning approval audit fields are missing.',
      'ADS_PROVISIONING_APPROVAL_REQUIRED'
    );
  }

  const required = DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER.google_ads;
  const missing = required.filter((r) => !request.requestedResources.includes(r));
  if (missing.length > 0) {
    throw new AdsProvisioningError(
      `Google Ads provisioning request missing resources: ${missing.join(', ')}`,
      'ADS_PROVISIONING_INVALID_REQUEST'
    );
  }
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {string} [customerName]
 */
async function resolveCustomerDisplayName(businessId, customerName) {
  if (typeof customerName === 'string' && customerName.trim()) {
    return customerName.trim();
  }

  const bc = await BusinessContext.findOne({ businessId }).select('businessName').lean();
  if (bc?.businessName?.trim()) {
    return `${bc.businessName.trim()} Ads`;
  }

  return 'Zuggernaut Ads Customer';
}

/**
 * Idempotent Google Ads customer provisioning/selection after explicit user approval.
 *
 * @param {object} input
 * @param {import('mongoose').Types.ObjectId | string} input.businessId
 * @param {import('mongoose').Types.ObjectId | string} input.setupRunId
 * @param {import('mongoose').Types.ObjectId | string} input.provisioningRequestId
 * @param {string} [input.customerName]
 * @param {import('pino').Logger} [input.logger]
 */
async function provisionGoogleAdsCustomer(input) {
  const { businessId, setupRunId, provisioningRequestId, customerName, logger } = input;

  maybeInjectFailure('ads_provisioning');

  const request = await IntegrationProvisioningRequest.findById(provisioningRequestId);
  assertApprovedAdsProvisioningRequest(request);

  if (String(request.businessId) !== String(businessId)) {
    throw new AdsProvisioningError(
      'Provisioning request business mismatch.',
      'ADS_PROVISIONING_BUSINESS_MISMATCH'
    );
  }

  await IntegrationProvisioningRequest.findByIdAndUpdate(provisioningRequestId, {
    $set: { status: 'provisioning', lastAttemptedAt: new Date(), setupRunId },
  });

  try {
    let customerResult;
    const existingArtifact = await findProvisioningArtifact({ businessId, setupRunId });
    if (existingArtifact) {
      customerResult = {
        customerId: existingArtifact.externalId,
        loginCustomerId: existingArtifact.metadata?.loginCustomerId ?? null,
        managerCustomerId: existingArtifact.metadata?.managerCustomerId ?? null,
        accessibleCustomerIds: existingArtifact.metadata?.accessibleCustomerIds ?? [existingArtifact.externalId],
        provisioningSource: existingArtifact.metadata?.provisioningSource ?? 'artifact_reuse',
        resourceName: existingArtifact.metadata?.resourceName ?? `customers/${existingArtifact.externalId}`,
      };
      logger?.info?.(
        { businessId: String(businessId), setupRunId: String(setupRunId), customerId: customerResult.customerId },
        'google ads customer artifact reused'
      );
    } else {
      const conn = await IntegrationConnection.findOne({ businessId, provider: 'google_ads' })
        .select('providerIdentifiers')
        .lean();
      const providerIdentifiers = conn?.providerIdentifiers ?? {};
      const storedAccessible = Array.isArray(providerIdentifiers.accessibleCustomerIds)
        ? providerIdentifiers.accessibleCustomerIds.map(normalizeCustomerId).filter(Boolean)
        : [];
      const selectedCustomerId = normalizeCustomerId(providerIdentifiers.customerId);
      const provisioningIntent = providerIdentifiers.provisioningIntent ?? null;
      const wantsMccCreate = provisioningIntent === 'mcc_create';

      if (
        selectedCustomerId &&
        storedAccessible.includes(selectedCustomerId) &&
        !wantsMccCreate
      ) {
        const loginCustomerId =
          normalizeCustomerId(providerIdentifiers.loginCustomerId) ??
          normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
        customerResult = {
          customerId: selectedCustomerId,
          ...(loginCustomerId ? { loginCustomerId, managerCustomerId: loginCustomerId } : {}),
          accessibleCustomerIds: storedAccessible,
          provisioningSource: 'discovery_selected_customer',
          resourceName: `customers/${selectedCustomerId}`,
        };
        logger?.info?.(
          { businessId: String(businessId), setupRunId: String(setupRunId), customerId: customerResult.customerId },
          'google ads customer selected from saved product selection'
        );
      } else if (storedAccessible.length > 0 && !wantsMccCreate) {
        throw new AdsProvisioningError(
          'Google Ads customer selection is required before provisioning.',
          'ADS_SELECTION_REQUIRED'
        );
      } else {
        const managerCustomerId = getGoogleAdsLoginCustomerId({ required: true });
        const descriptiveName = await resolveCustomerDisplayName(businessId, customerName);
        const mccAccessToken = await getMccGoogleAdsAccessToken();
        const created = await createCustomerClient(mccAccessToken, managerCustomerId, { descriptiveName });
        customerResult = {
          customerId: created.customerId,
          loginCustomerId: managerCustomerId,
          managerCustomerId,
          accessibleCustomerIds: [created.customerId],
          provisioningSource: created.provisioningSource,
          resourceName: created.resourceName,
          descriptiveName: created.descriptiveName,
        };
        logger?.info?.(
          { businessId: String(businessId), setupRunId: String(setupRunId), customerId: customerResult.customerId },
          'google ads customer provisioned via mcc'
        );
      }

      await persistProvisioningArtifact({
        businessId,
        setupRunId,
        externalId: customerResult.customerId,
        metadata: customerResult,
      });
    }

    const providerIdentifiers = {
      customerId: customerResult.customerId,
      accessibleCustomerIds: customerResult.accessibleCustomerIds,
      ...(customerResult.loginCustomerId ? { loginCustomerId: customerResult.loginCustomerId } : {}),
      ...(customerResult.managerCustomerId ? { managerCustomerId: customerResult.managerCustomerId } : {}),
    };

    if (customerResult.provisioningSource === 'mcc_create') {
      const mccLink = buildNewlyCreatedUnderMccLink(
        customerResult.customerId,
        customerResult.managerCustomerId ?? customerResult.loginCustomerId
      );
      if (mccLink) {
        providerIdentifiers.mccLink = mccLink;
      }
    }

    if (!hasRequiredIdentifiers('google_ads', providerIdentifiers)) {
      throw new AdsProvisioningError(
        'Google Ads provisioning completed without required identifiers.',
        'ADS_PROVISIONING_INCOMPLETE'
      );
    }

    await IntegrationConnection.findOneAndUpdate(
      { businessId, provider: 'google_ads' },
      {
        $set: {
          connectionHealth: 'connected',
          providerIdentifiers,
        },
      }
    );

    await IntegrationProvisioningRequest.findByIdAndUpdate(provisioningRequestId, {
      $set: {
        status: 'provisioned',
        createdProviderIdentifiers: providerIdentifiers,
        errorCode: null,
        errorMessage: null,
        lastAttemptedAt: new Date(),
      },
    });

    return {
      providerIdentifiers,
      connectionHealth: 'connected',
    };
  } catch (err) {
    const errorCode =
      err instanceof AdsProvisioningError || err instanceof GoogleAdsAccountError
        ? err.code
        : typeof err.code === 'string'
          ? err.code
          : 'ADS_PROVISIONING_FAILED';

    if (errorCode === 'ADS_SELECTION_REQUIRED') {
      await IntegrationProvisioningRequest.findByIdAndUpdate(provisioningRequestId, {
        $set: {
          status: 'approved',
          errorCode,
          errorMessage: err.message,
          lastAttemptedAt: new Date(),
        },
      });
      await IntegrationConnection.findOneAndUpdate(
        { businessId, provider: 'google_ads' },
        {
          $set: {
            connectionHealth: 'selection_required',
            'providerIdentifiers.selectionRequired': true,
          },
        }
      );
      throw err;
    }

    await IntegrationProvisioningRequest.findByIdAndUpdate(provisioningRequestId, {
      $set: {
        status: 'failed',
        errorCode,
        errorMessage: err.message,
        lastAttemptedAt: new Date(),
      },
    });

    throw err;
  }
}

module.exports = {
  AdsProvisioningError,
  provisioningArtifactIdempotencyKey,
  provisionGoogleAdsCustomer,
};
