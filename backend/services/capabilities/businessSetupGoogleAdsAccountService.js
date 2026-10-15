'use strict';

const mongoose = require('mongoose');
const { adsProvisioningIdempotencyKey } = require('../../constants/idempotency');
const { SUPPORTED_ACCOUNT_CURRENCIES } = require('../../constants/leadCampaign');
const { createLogger } = require('../../lib/observability/logger');
const {
  createCustomerClient,
  getGoogleAdsLoginCustomerId,
  normalizeCustomerId,
  GoogleAdsAccountError,
} = require('../integrations/googleAdsAccountClient');
const { getMccGoogleAdsAccessToken } = require('../integrations/googleTokenService');
const { hasRequiredIdentifiers } = require('../integrations/providerDiscoveryResult');
const { buildNewlyCreatedUnderMccLink } = require('./googleAdsMccLinkService');
const {
  claimProviderResource,
  finalizeProviderResourceClaim,
  markProviderResourceClaimFailed,
  isCreatedProviderArtifact,
  ProviderResourceClaimError,
} = require('./providerResourceClaim');

const IntegrationConnection = mongoose.model('IntegrationConnection');
const BusinessContext = mongoose.model('BusinessContext');

const logger = createLogger({ name: 'businessSetupGoogleAdsAccount' });

class BusinessSetupGoogleAdsAccountError extends Error {
  constructor(message, code = 'ADS_BUSINESS_SETUP_CREATE_ERROR') {
    super(message);
    this.name = 'BusinessSetupGoogleAdsAccountError';
    this.code = code;
  }
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function resolveCustomerDisplayName(businessId) {
  const bc = await BusinessContext.findOne({ businessId }).select('businessName').lean();
  if (bc?.businessName?.trim()) {
    return `${bc.businessName.trim()} Ads`;
  }
  return 'Zuggernaut Ads Customer';
}

/**
 * @param {object} input
 * @param {import('mongoose').Types.ObjectId | string} input.businessId
 * @param {string} input.currencyCode
 * @param {string} input.timeZone
 */
async function createGoogleAdsAccountForBusinessSetup(input) {
  const { businessId, currencyCode, timeZone } = input;
  const normalizedCurrency = String(currencyCode ?? '').trim().toUpperCase();
  const normalizedTimeZone = String(timeZone ?? '').trim();
  if (!normalizedCurrency) {
    throw new BusinessSetupGoogleAdsAccountError('currencyCode is required.', 'ADS_CREATE_INPUT_INVALID');
  }
  if (!SUPPORTED_ACCOUNT_CURRENCIES.includes(normalizedCurrency)) {
    throw new BusinessSetupGoogleAdsAccountError(
      `currencyCode must be one of ${SUPPORTED_ACCOUNT_CURRENCIES.join(', ')}.`,
      'ADS_UNSUPPORTED_CURRENCY'
    );
  }
  if (!normalizedTimeZone) {
    throw new BusinessSetupGoogleAdsAccountError('timeZone is required.', 'ADS_CREATE_INPUT_INVALID');
  }

  const idempotencyKey = adsProvisioningIdempotencyKey(businessId);
  const existingConn = await IntegrationConnection.findOne({ businessId, provider: 'google_ads' })
    .select('providerIdentifiers connectionHealth')
    .lean();
  const existingCustomerId = normalizeCustomerId(existingConn?.providerIdentifiers?.customerId);
  if (existingCustomerId && existingConn?.connectionHealth === 'connected') {
    return {
      customerId: existingCustomerId,
      idempotent: true,
    };
  }

  let claim;
  try {
    claim = await claimProviderResource({
      businessId,
      provider: 'google_ads',
      artifactType: 'ads_customer',
      idempotencyKey,
      pendingExternalId: `pending:ads-customer:${businessId}`,
      claimMetadata: { currencyCode: normalizedCurrency, timeZone: normalizedTimeZone, source: 'business_setup_step1' },
    });
  } catch (err) {
    if (err instanceof ProviderResourceClaimError && err.code === 'PROVIDER_RESOURCE_CLAIM_IN_PROGRESS') {
      throw new BusinessSetupGoogleAdsAccountError(
        'Google Ads account creation is already in progress. Try again shortly.',
        err.code
      );
    }
    throw err;
  }

  if (!claim.claimed && isCreatedProviderArtifact(claim.artifact)) {
    const customerId = normalizeCustomerId(claim.artifact.externalId);
    if (customerId) {
      const meta = claim.artifact.metadata ?? {};
      await persistGoogleAdsConnection(
        businessId,
        {
          ...meta,
          customerId,
          accessibleCustomerIds: meta.accessibleCustomerIds ?? [customerId],
          provisioningSource: meta.provisioningSource ?? 'mcc_create',
        },
        customerId
      );
      return { customerId, idempotent: true };
    }
  }

  const managerCustomerId = getGoogleAdsLoginCustomerId({ required: true });
  const descriptiveName = await resolveCustomerDisplayName(businessId);
  const mccAccessToken = await getMccGoogleAdsAccessToken();

  try {
    const created = await createCustomerClient(mccAccessToken, managerCustomerId, {
      descriptiveName,
      currencyCode: normalizedCurrency,
      timeZone: normalizedTimeZone,
    });

    await finalizeProviderResourceClaim({
      idempotencyKey,
      externalId: created.customerId,
      metadataPatch: {
        loginCustomerId: managerCustomerId,
        managerCustomerId,
        accessibleCustomerIds: [created.customerId],
        provisioningSource: created.provisioningSource,
        resourceName: created.resourceName,
        currencyCode: normalizedCurrency,
        timeZone: normalizedTimeZone,
      },
    });

    const customerResult = {
      customerId: created.customerId,
      loginCustomerId: managerCustomerId,
      managerCustomerId,
      accessibleCustomerIds: [created.customerId],
      provisioningSource: created.provisioningSource,
    };

    await persistGoogleAdsConnection(businessId, customerResult, created.customerId);

    logger.info(
      { businessId: String(businessId), customerId: created.customerId, stepName: 'business_setup_accounts' },
      'google ads customer created from business setup step 1'
    );

    return { customerId: created.customerId, idempotent: false };
  } catch (err) {
    await markProviderResourceClaimFailed({
      idempotencyKey,
      errorCode: err?.code ?? 'ADS_CUSTOMER_CREATE_FAILED',
      errorMessage: err instanceof Error ? err.message : 'create failed',
    });
    if (err instanceof GoogleAdsAccountError) {
      throw new BusinessSetupGoogleAdsAccountError(err.message, err.code);
    }
    throw err;
  }
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {object} customerResult
 * @param {string} customerId
 */
async function persistGoogleAdsConnection(businessId, customerResult, customerId) {
  const managerCustomerId =
    customerResult.managerCustomerId ?? customerResult.loginCustomerId ?? getGoogleAdsLoginCustomerId();
  const providerIdentifiers = {
    customerId,
    accessibleCustomerIds: customerResult.accessibleCustomerIds ?? [customerId],
    ...(managerCustomerId ? { loginCustomerId: managerCustomerId, managerCustomerId } : {}),
  };

  const mccLink = buildNewlyCreatedUnderMccLink(customerId, managerCustomerId);
  if (mccLink) {
    providerIdentifiers.mccLink = mccLink;
  }

  if (!hasRequiredIdentifiers('google_ads', providerIdentifiers)) {
    throw new BusinessSetupGoogleAdsAccountError(
      'Google Ads account creation completed without required identifiers.',
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
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

module.exports = {
  BusinessSetupGoogleAdsAccountError,
  createGoogleAdsAccountForBusinessSetup,
};
