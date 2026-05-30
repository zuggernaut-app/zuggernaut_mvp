'use strict';

const axios = require('axios');
const { withProviderRateLimit } = require('../../lib/providerRateLimit');
const { getFreshGoogleAccessToken } = require('./googleTokenService');
const { normalizeCustomerId, GoogleAdsApiError } = require('./googleAdsConversionCatalogClient');

const GOOGLE_ADS_API_VERSION = process.env.GOOGLE_ADS_API_VERSION?.trim() || 'v18';

/**
 * @param {string} customerId — digits only
 * @param {string} collection — e.g. campaignBudgets
 * @param {string} logicalKey
 */
function mockResourceName(customerId, collection, logicalKey) {
  return `customers/${customerId}/${collection}/${logicalKey}`;
}

/**
 * @param {object} ctx
 * @param {string} ctx.customerId
 * @param {string} ctx.setupRunId
 * @param {object} ctx.intent
 */
async function createCampaignBudget(ctx) {
  const { customerId, setupRunId, intent } = ctx;
  const logicalKey = `zug-budget-${setupRunId}`;

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return {
      resourceName: mockResourceName(customerId, 'campaignBudgets', logicalKey),
      source: 'google_ads_api_mock',
    };
  }

  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    throw new GoogleAdsApiError(
      'Google Ads API is not enabled (set GOOGLE_ADS_API_ENABLED=true after configuring credentials).',
      'GOOGLE_ADS_API_NOT_ENABLED'
    );
  }

  const accessToken = await getFreshGoogleAccessToken({ businessId: ctx.businessId, provider: 'google_ads' });
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/campaignBudgets:mutate`;
  const res = await axios.post(
    url,
    {
      operations: [
        {
          create: {
            name: intent.budget.name,
            amountMicros: String(intent.budget.amountMicros),
            deliveryMethod: 'STANDARD',
            explicitlyShared: false,
          },
        },
      ],
    },
    {
      headers: buildHeaders(accessToken),
      timeout: 30000,
      validateStatus: () => true,
    }
  );

  const resourceName = extractMutateResourceName(res, 'campaign budget');
  return { resourceName, source: 'google_ads_api' };
}

/**
 * @param {object} ctx
 */
async function createCampaign(ctx) {
  const { customerId, setupRunId, intent, budgetResourceName } = ctx;
  const logicalKey = `zug-campaign-${setupRunId}`;

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return {
      resourceName: mockResourceName(customerId, 'campaigns', logicalKey),
      source: 'google_ads_api_mock',
    };
  }

  const accessToken = await getFreshGoogleAccessToken({ businessId: ctx.businessId, provider: 'google_ads' });
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/campaigns:mutate`;
  const res = await axios.post(
    url,
    {
      operations: [
        {
          create: {
            name: intent.campaignName,
            advertisingChannelType: 'SEARCH',
            status: 'PAUSED',
            campaignBudget: budgetResourceName,
            maximizeConversions: {},
          },
        },
      ],
    },
    {
      headers: buildHeaders(accessToken),
      timeout: 30000,
      validateStatus: () => true,
    }
  );

  const resourceName = extractMutateResourceName(res, 'campaign');
  return { resourceName, source: 'google_ads_api' };
}

/**
 * @param {object} ctx
 */
async function createAdGroup(ctx) {
  const { customerId, setupRunId, intent, campaignResourceName } = ctx;
  const logicalKey = `zug-adgroup-${setupRunId}`;

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return {
      resourceName: mockResourceName(customerId, 'adGroups', logicalKey),
      source: 'google_ads_api_mock',
    };
  }

  const accessToken = await getFreshGoogleAccessToken({ businessId: ctx.businessId, provider: 'google_ads' });
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/adGroups:mutate`;
  const res = await axios.post(
    url,
    {
      operations: [
        {
          create: {
            name: intent.adGroupName,
            campaign: campaignResourceName,
            status: 'ENABLED',
            type: 'SEARCH_STANDARD',
          },
        },
      ],
    },
    {
      headers: buildHeaders(accessToken),
      timeout: 30000,
      validateStatus: () => true,
    }
  );

  const resourceName = extractMutateResourceName(res, 'ad group');
  return { resourceName, source: 'google_ads_api' };
}

/**
 * @param {object} ctx
 */
async function createResponsiveSearchAd(ctx) {
  const { customerId, setupRunId, intent, adGroupResourceName } = ctx;
  const logicalKey = `zug-ad-${setupRunId}`;

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return {
      resourceName: mockResourceName(customerId, 'adGroupAds', logicalKey),
      source: 'google_ads_api_mock',
    };
  }

  const accessToken = await getFreshGoogleAccessToken({ businessId: ctx.businessId, provider: 'google_ads' });
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/adGroupAds:mutate`;
  const res = await axios.post(
    url,
    {
      operations: [
        {
          create: {
            adGroup: adGroupResourceName,
            status: 'ENABLED',
            ad: {
              responsiveSearchAd: {
                headlines: intent.ad.headlines.map((text) => ({ text })),
                descriptions: intent.ad.descriptions.map((text) => ({ text })),
              },
              finalUrls: [intent.ad.finalUrl],
            },
          },
        },
      ],
    },
    {
      headers: buildHeaders(accessToken),
      timeout: 30000,
      validateStatus: () => true,
    }
  );

  const resourceName = extractMutateResourceName(res, 'ad group ad');
  return { resourceName, source: 'google_ads_api' };
}

/**
 * @param {string} accessToken
 */
function buildHeaders(accessToken) {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  if (!developerToken) {
    throw new GoogleAdsApiError(
      'GOOGLE_ADS_DEVELOPER_TOKEN is required when Google Ads API is enabled.',
      'GOOGLE_ADS_DEVELOPER_TOKEN_MISSING'
    );
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
    'Content-Type': 'application/json',
  };

  const loginCustomerId = normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  if (loginCustomerId) {
    headers['login-customer-id'] = loginCustomerId;
  }

  return headers;
}

/**
 * @param {import('axios').AxiosResponse} res
 * @param {string} label
 */
function extractMutateResourceName(res, label) {
  if (res.status < 200 || res.status >= 300) {
    throw new GoogleAdsApiError(`Google Ads ${label} mutate failed (${res.status})`, 'GOOGLE_ADS_MUTATE_FAILED');
  }

  const resourceName = res.data?.results?.[0]?.resourceName;
  if (!resourceName) {
    throw new GoogleAdsApiError(`Google Ads ${label} mutate returned no resourceName`, 'GOOGLE_ADS_MUTATE_INVALID');
  }

  return resourceName;
}

/**
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 * @param {string} ctx.campaignResourceName
 */
async function pauseAdsCampaign(ctx) {
  const { businessId, campaignResourceName } = ctx;

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return { outcome: 'paused', source: 'google_ads_api_mock' };
  }

  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    return { outcome: 'skipped_api_disabled', source: 'google_ads_api' };
  }

  const customerId = normalizeCustomerId(campaignResourceName.split('/')[1]);
  if (!customerId) {
    throw new GoogleAdsApiError('Invalid campaign resource name for pause.', 'GOOGLE_ADS_PAUSE_INVALID');
  }

  const accessToken = await getFreshGoogleAccessToken({ businessId, provider: 'google_ads' });
  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerId}/campaigns:mutate`;
  const res = await axios.post(
    url,
    {
      operations: [
        {
          update: {
            resourceName: campaignResourceName,
            status: 'PAUSED',
          },
          updateMask: 'status',
        },
      ],
    },
    {
      headers: buildHeaders(accessToken),
      timeout: 30000,
      validateStatus: () => true,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw new GoogleAdsApiError(`Google Ads campaign pause failed (${res.status})`, 'GOOGLE_ADS_PAUSE_FAILED');
  }

  return { outcome: 'paused', source: 'google_ads_api' };
}

module.exports = {
  mockResourceName,
  createCampaignBudget: (ctx) => withProviderRateLimit('google_ads', () => createCampaignBudget(ctx)),
  createCampaign: (ctx) => withProviderRateLimit('google_ads', () => createCampaign(ctx)),
  createAdGroup: (ctx) => withProviderRateLimit('google_ads', () => createAdGroup(ctx)),
  createResponsiveSearchAd: (ctx) => withProviderRateLimit('google_ads', () => createResponsiveSearchAd(ctx)),
  pauseAdsCampaign: (ctx) => withProviderRateLimit('google_ads', () => pauseAdsCampaign(ctx)),
};
