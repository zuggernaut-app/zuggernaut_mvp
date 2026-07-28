'use strict';

/**
 * Google Ads Conversion Action Client
 *
 * Write operations: creating conversion actions via conversionActions:mutate.
 * Read operations live in googleAdsConversionCatalogClient.js.
 */

const crypto = require('crypto');
const { withProviderRateLimit } = require('../../lib/providerRateLimit');
const { resolveGoogleAdsCustomerAuth } = require('./googleAdsCustomerAuth');
const { mockResourceName } = require('./googleAdsCampaignClient');
const {
  GoogleAdsApiError,
  buildGoogleAdsApiUrl,
  buildGoogleAdsHeaders,
  createGoogleAdsApiErrorFromResponse,
  getGoogleAdsRequestTimeoutMs,
  googleAdsPost,
  isConversionActionCreationEnabled,
  normalizeCustomerId,
} = require('./googleAdsApiConfig');

/**
 * @param {string} idempotencyKey
 * @returns {string}
 */
function mockExternalIdFromIdempotencyKey(idempotencyKey) {
  return `mock-ca-${idempotencyKey}`;
}

/**
 * @param {import('axios').AxiosResponse} res
 * @param {string} customerId
 */
function extractMutateResourceName(res, customerId) {
  if (res.status < 200 || res.status >= 300) {
    throw createGoogleAdsApiErrorFromResponse(
      res.status,
      res.data,
      'GOOGLE_ADS_CONVERSION_ACTION_CREATE_FAILED',
      {
        label: 'Google Ads conversion action mutate',
        action: 'conversionActions:mutate',
        customerIds: [customerId],
      }
    );
  }

  const resourceName = res.data?.results?.[0]?.resourceName;
  if (!resourceName) {
    throw new GoogleAdsApiError(
      'Google Ads conversion action mutate returned no resourceName',
      'GOOGLE_ADS_MUTATE_INVALID'
    );
  }

  return resourceName;
}

/**
 * @param {string} resourceName
 * @returns {string}
 */
function externalIdFromResourceName(resourceName) {
  const parts = String(resourceName).split('/');
  const externalId = parts[parts.length - 1];
  if (!externalId) {
    throw new GoogleAdsApiError(
      'Google Ads conversion action resourceName missing externalId',
      'GOOGLE_ADS_MUTATE_INVALID'
    );
  }
  return externalId;
}

/** Conversion types that accept valueSettings on create (Google Ads API v24). */
const VALUE_SETTINGS_TYPES = new Set([
  'WEBPAGE',
  'AD_CALL',
  'WEBSITE_CALL',
  'UPLOAD_CLICKS',
  'UPLOAD_CONVERSIONS',
  'STORE_VISITS',
]);

/**
 * @param {object} config
 */
function buildConversionActionCreatePayload(config) {
  const payload = {
    name: config.name,
    category: config.category,
    type: config.type,
    countingType: config.countingType,
    status: config.status,
  };

  // includeInConversionsMetric is immutable on create; primary_for_goal is set separately.
  // valueSettings must be nested — flat defaultValue/alwaysUseDefaultValue are rejected.
  if (VALUE_SETTINGS_TYPES.has(config.type)) {
    const valueSettings = {};
    if (config.defaultValue !== undefined) {
      valueSettings.defaultValue = config.defaultValue;
    }
    if (config.alwaysUseDefaultValue !== undefined) {
      valueSettings.alwaysUseDefaultValue = config.alwaysUseDefaultValue;
    }
    if (Object.keys(valueSettings).length > 0) {
      payload.valueSettings = valueSettings;
    }
  }

  return payload;
}

/**
 * Creates a conversion action using mock data (for dev/test mode).
 *
 * @param {object} ctx
 * @param {string} ctx.customerId
 * @param {object} ctx.conversionActionConfig
 * @param {string} ctx.idempotencyKey
 * @returns {Promise<{ resourceName: string, externalId: string, source: string }>}
 */
async function createConversionActionMock(ctx) {
  const { customerId, idempotencyKey } = ctx;
  const normalizedCustomerId = normalizeCustomerId(customerId) ?? 'mockcustomerid';
  const externalId = mockExternalIdFromIdempotencyKey(idempotencyKey);
  const logicalKey = crypto.createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 16);

  return {
    resourceName: mockResourceName(normalizedCustomerId, 'conversionActions', logicalKey),
    externalId,
    source: 'google_ads_api_mock',
  };
}

/**
 * Creates a single conversion action in a Google Ads account.
 *
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 * @param {string} ctx.customerId — digits-only customer ID
 * @param {object} ctx.conversionActionConfig — fields matching DEFAULT_CONVERSION_ACTION_TEMPLATES shape
 * @param {string} ctx.idempotencyKey — stable key to prevent duplicate creation
 * @returns {Promise<{ resourceName: string, externalId: string, source: string }>}
 * @throws {GoogleAdsApiError}
 */
async function createConversionAction(ctx) {
  const { businessId, customerId, conversionActionConfig, idempotencyKey } = ctx;

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return createConversionActionMock(ctx);
  }

  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    throw new GoogleAdsApiError(
      'Google Ads API is not enabled (set GOOGLE_ADS_API_ENABLED=true after configuring credentials).',
      'GOOGLE_ADS_API_NOT_ENABLED'
    );
  }

  if (!isConversionActionCreationEnabled()) {
    throw new GoogleAdsApiError(
      'Google Ads conversion action creation is disabled (set GOOGLE_ADS_CONVERSION_ACTION_CREATION_ENABLED=true to opt in).',
      'GOOGLE_ADS_CONVERSION_CREATION_DISABLED'
    );
  }

  const normalizedCustomerId = normalizeCustomerId(customerId);
  if (!normalizedCustomerId) {
    throw new GoogleAdsApiError(
      'Google Ads customerId missing for conversion action creation.',
      'GOOGLE_ADS_CUSTOMER_ID_MISSING'
    );
  }

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(businessId, normalizedCustomerId);
  const url = buildGoogleAdsApiUrl(`customers/${normalizedCustomerId}/conversionActions:mutate`);
  const res = await googleAdsPost(
    url,
    {
      operations: [
        {
          create: buildConversionActionCreatePayload(conversionActionConfig),
        },
      ],
    },
    {
      headers: buildGoogleAdsHeaders(accessToken, headerOpts),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  const resourceName = extractMutateResourceName(res, normalizedCustomerId);
  const externalId = externalIdFromResourceName(resourceName);

  void idempotencyKey;

  return { resourceName, externalId, source: 'google_ads_api' };
}

module.exports = {
  createConversionAction: (ctx) => withProviderRateLimit('google_ads', () => createConversionAction(ctx)),
  createConversionActionMock,
  mockExternalIdFromIdempotencyKey,
  buildConversionActionCreatePayload,
};
