'use strict';

const axios = require('axios');
const { withProviderRateLimit } = require('../../lib/providerRateLimit');
const { getFreshGoogleAccessToken } = require('./googleTokenService');
const {
  GoogleAdsApiError,
  buildGoogleAdsApiUrl,
  buildGoogleAdsHeaders,
  createGoogleAdsApiErrorFromResponse,
  getGoogleAdsRequestTimeoutMs,
  normalizeCustomerId,
} = require('./googleAdsApiConfig');

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
  const url = buildGoogleAdsApiUrl(`customers/${customerId}/campaignBudgets:mutate`);
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
      headers: buildGoogleAdsHeaders(accessToken),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  const resourceName = extractMutateResourceName(res, 'campaign budget', customerId);
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
  const url = buildGoogleAdsApiUrl(`customers/${customerId}/campaigns:mutate`);
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
      headers: buildGoogleAdsHeaders(accessToken),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  const resourceName = extractMutateResourceName(res, 'campaign', customerId);
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
  const url = buildGoogleAdsApiUrl(`customers/${customerId}/adGroups:mutate`);
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
      headers: buildGoogleAdsHeaders(accessToken),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  const resourceName = extractMutateResourceName(res, 'ad group', customerId);
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
  const url = buildGoogleAdsApiUrl(`customers/${customerId}/adGroupAds:mutate`);
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
      headers: buildGoogleAdsHeaders(accessToken),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  const resourceName = extractMutateResourceName(res, 'ad group ad', customerId);
  return { resourceName, source: 'google_ads_api' };
}

/**
 * @param {import('axios').AxiosResponse} res
 * @param {string} label
 */
function extractMutateResourceName(res, label, customerId) {
  if (res.status < 200 || res.status >= 300) {
    throw createGoogleAdsApiErrorFromResponse(
      res.status,
      res.data,
      'GOOGLE_ADS_MUTATE_FAILED',
      { label: `Google Ads ${label} mutate`, action: `${label}:mutate`, customerIds: [customerId] }
    );
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
  const url = buildGoogleAdsApiUrl(`customers/${customerId}/campaigns:mutate`);
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
      headers: buildGoogleAdsHeaders(accessToken),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw createGoogleAdsApiErrorFromResponse(
      res.status,
      res.data,
      'GOOGLE_ADS_PAUSE_FAILED',
      { label: 'Google Ads campaign pause', action: 'campaigns:mutate', customerIds: [customerId] }
    );
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
