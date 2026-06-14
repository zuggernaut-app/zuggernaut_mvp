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
const {
  mockResourceName,
  buildSearchCampaignCreatePayload,
  buildResponsiveSearchAdCreatePayload,
} = require('./googleAdsCampaignClient');

/**
 * @param {import('axios').AxiosResponse} res
 * @param {string} label
 * @param {string} customerId
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
 */
async function adsMutate(ctx) {
  const { businessId, customerId, collection, operations, label } = ctx;

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    const logicalKey = operations[0]?.logicalKey ?? `zug-diag-${collection}`;
    return {
      resourceName: mockResourceName(customerId, collection, logicalKey),
      source: 'google_ads_api_mock',
    };
  }

  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    throw new GoogleAdsApiError(
      'Google Ads API is not enabled (set GOOGLE_ADS_API_ENABLED=true after configuring credentials).',
      'GOOGLE_ADS_API_NOT_ENABLED'
    );
  }

  const accessToken = await getFreshGoogleAccessToken({ businessId, provider: 'google_ads' });
  const url = buildGoogleAdsApiUrl(`customers/${customerId}/${collection}:mutate`);
  const res = await axios.post(
    url,
    { operations: operations.map(({ logicalKey: _lk, ...op }) => op) },
    {
      headers: buildGoogleAdsHeaders(accessToken, {
        loginCustomerId: ctx.loginCustomerId,
      }),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  const resourceName = extractMutateResourceName(res, label, customerId);
  return { resourceName, source: 'google_ads_api' };
}

async function createDiagnosticCampaignBudget(ctx) {
  const { customerId, resourceLabel } = ctx;
  return adsMutate({
    ...ctx,
    collection: 'campaignBudgets',
    label: 'campaign budget',
    operations: [
      {
        logicalKey: `diag-budget-${resourceLabel}`,
        create: {
          name: resourceLabel,
          amountMicros: '10000000',
          deliveryMethod: 'STANDARD',
          explicitlyShared: false,
        },
      },
    ],
  });
}

async function createDiagnosticSearchCampaign(ctx) {
  const { customerId, resourceLabel, budgetResourceName } = ctx;
  return adsMutate({
    ...ctx,
    collection: 'campaigns',
    label: 'campaign',
    operations: [
      {
        logicalKey: `diag-campaign-${resourceLabel}`,
        create: buildSearchCampaignCreatePayload({
          name: resourceLabel,
          campaignBudget: budgetResourceName,
        }),
      },
    ],
  });
}

async function attachDiagnosticLocationTargeting(ctx) {
  const { customerId, resourceLabel, campaignResourceName } = ctx;
  return adsMutate({
    ...ctx,
    collection: 'campaignCriteria',
    label: 'location criterion',
    operations: [
      {
        logicalKey: `diag-location-${resourceLabel}`,
        create: {
          campaign: campaignResourceName,
          location: {
            geoTargetConstant: 'geoTargetConstants/2840',
          },
        },
      },
    ],
  });
}

async function attachDiagnosticLanguageTargeting(ctx) {
  const { customerId, resourceLabel, campaignResourceName } = ctx;
  return adsMutate({
    ...ctx,
    collection: 'campaignCriteria',
    label: 'language criterion',
    operations: [
      {
        logicalKey: `diag-language-${resourceLabel}`,
        create: {
          campaign: campaignResourceName,
          language: {
            languageConstant: 'languageConstants/1000',
          },
        },
      },
    ],
  });
}

async function attachDiagnosticAdSchedule(ctx) {
  const { customerId, resourceLabel, campaignResourceName } = ctx;
  return adsMutate({
    ...ctx,
    collection: 'campaignCriteria',
    label: 'ad schedule criterion',
    operations: [
      {
        logicalKey: `diag-schedule-${resourceLabel}`,
        create: {
          campaign: campaignResourceName,
          adSchedule: {
            dayOfWeek: 'MONDAY',
            startHour: 9,
            endHour: 17,
            startMinute: 'ZERO',
            endMinute: 'ZERO',
          },
        },
      },
    ],
  });
}

async function createDiagnosticAdGroup(ctx) {
  const { customerId, resourceLabel, campaignResourceName } = ctx;
  return adsMutate({
    ...ctx,
    collection: 'adGroups',
    label: 'ad group',
    operations: [
      {
        logicalKey: `diag-adgroup-${resourceLabel}`,
        create: {
          name: resourceLabel,
          campaign: campaignResourceName,
          status: 'PAUSED',
          type: 'SEARCH_STANDARD',
        },
      },
    ],
  });
}

async function createDiagnosticResponsiveSearchAd(ctx) {
  const { customerId, resourceLabel, adGroupResourceName, finalUrl } = ctx;
  return adsMutate({
    ...ctx,
    collection: 'adGroupAds',
    label: 'responsive search ad',
    operations: [
      {
        logicalKey: `diag-ad-${resourceLabel}`,
        create: buildResponsiveSearchAdCreatePayload({
          adGroupResourceName,
          finalUrl: finalUrl || 'https://example.com',
          headlines: ['Zuggernaut Dev Test', 'Diagnostic Search Ad', 'Paused Setup Check'],
          descriptions: [
            'Paused diagnostic ad created by Zuggernaut.',
            'Real-mode Google Ads write validation.',
          ],
          fallbacks: { businessName: 'Zuggernaut' },
        }),
      },
    ],
  });
}

async function addDiagnosticKeyword(ctx) {
  const { customerId, resourceLabel, adGroupResourceName, keywordText, matchType } = ctx;
  return adsMutate({
    ...ctx,
    collection: 'adGroupCriteria',
    label: 'keyword',
    operations: [
      {
        logicalKey: `diag-kw-${matchType}-${resourceLabel}`,
        create: {
          adGroup: adGroupResourceName,
          status: 'PAUSED',
          keyword: {
            text: keywordText,
            matchType,
          },
        },
      },
    ],
  });
}

async function createDiagnosticConversionAction(ctx) {
  const { customerId, resourceLabel } = ctx;
  return adsMutate({
    ...ctx,
    collection: 'conversionActions',
    label: 'conversion action',
    operations: [
      {
        logicalKey: `diag-conv-${resourceLabel}`,
        create: {
          name: resourceLabel,
          category: 'DEFAULT',
          type: 'WEBPAGE',
          status: 'ENABLED',
          countingType: 'ONE_PER_CLICK',
        },
      },
    ],
  });
}

async function createDiagnosticSitelinkAsset(ctx) {
  const { customerId, resourceLabel, campaignResourceName } = ctx;
  const asset = await adsMutate({
    ...ctx,
    collection: 'assets',
    label: 'sitelink asset',
    operations: [
      {
        logicalKey: `diag-sitelink-${resourceLabel}`,
        create: {
          sitelinkAsset: {
            linkText: 'Dev Test Link',
            description1: 'Diagnostic sitelink',
            description2: 'Created by Zuggernaut',
          },
          finalUrls: ['https://example.com/dev-test'],
        },
      },
    ],
  });

  await adsMutate({
    ...ctx,
    collection: 'campaignAssets',
    label: 'campaign sitelink',
    operations: [
      {
        logicalKey: `diag-sitelink-link-${resourceLabel}`,
        create: {
          campaign: campaignResourceName,
          asset: asset.resourceName,
          fieldType: 'SITELINK',
        },
      },
    ],
  });

  return asset;
}

async function createDiagnosticCalloutAsset(ctx) {
  const { customerId, resourceLabel, campaignResourceName } = ctx;
  const asset = await adsMutate({
    ...ctx,
    collection: 'assets',
    label: 'callout asset',
    operations: [
      {
        logicalKey: `diag-callout-${resourceLabel}`,
        create: {
          calloutAsset: {
            calloutText: 'Dev diagnostic callout',
          },
        },
      },
    ],
  });

  await adsMutate({
    ...ctx,
    collection: 'campaignAssets',
    label: 'campaign callout',
    operations: [
      {
        logicalKey: `diag-callout-link-${resourceLabel}`,
        create: {
          campaign: campaignResourceName,
          asset: asset.resourceName,
          fieldType: 'CALLOUT',
        },
      },
    ],
  });

  return asset;
}

async function createDiagnosticCallAsset(ctx) {
  const { customerId, resourceLabel, campaignResourceName, phoneNumber } = ctx;
  const asset = await adsMutate({
    ...ctx,
    collection: 'assets',
    label: 'call asset',
    operations: [
      {
        logicalKey: `diag-call-${resourceLabel}`,
        create: {
          callAsset: {
            countryCode: 'US',
            phoneNumber,
          },
        },
      },
    ],
  });

  await adsMutate({
    ...ctx,
    collection: 'campaignAssets',
    label: 'campaign call asset',
    operations: [
      {
        logicalKey: `diag-call-link-${resourceLabel}`,
        create: {
          campaign: campaignResourceName,
          asset: asset.resourceName,
          fieldType: 'CALL',
        },
      },
    ],
  });

  return asset;
}

async function createDiagnosticRemarketingUserList(ctx) {
  const { customerId, resourceLabel } = ctx;
  return adsMutate({
    ...ctx,
    collection: 'userLists',
    label: 'remarketing user list',
    operations: [
      {
        logicalKey: `diag-remarketing-${resourceLabel}`,
        create: {
          name: resourceLabel,
          description: 'Zuggernaut dev diagnostic remarketing list',
          membershipStatus: 'OPEN',
          membershipLifeSpan: 30,
          ruleBasedUserList: {
            prepopulationStatus: 'REQUESTED',
            flexibleRuleUserList: {
              inclusiveRuleOperator: 'AND',
              inclusiveOperands: [
                {
                  rule: {
                    ruleItemGroups: [
                      {
                        ruleItems: [
                          {
                            name: 'url__',
                            stringRuleItem: {
                              operator: 'CONTAINS',
                              value: 'example.com',
                            },
                          },
                        ],
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    ],
  });
}

async function createDiagnosticNegativeKeywordList(ctx) {
  const { customerId, resourceLabel } = ctx;
  return adsMutate({
    ...ctx,
    collection: 'sharedSets',
    label: 'negative keyword list',
    operations: [
      {
        logicalKey: `diag-neg-kw-${resourceLabel}`,
        create: {
          name: resourceLabel,
          type: 'NEGATIVE_KEYWORDS',
        },
      },
    ],
  });
}

async function validateOfflineConversionImport(ctx) {
  const { businessId, customerId } = ctx;

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return {
      ok: true,
      message: 'Offline conversion import prerequisites validated (mock).',
      source: 'google_ads_api_mock',
    };
  }

  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    throw new GoogleAdsApiError(
      'Google Ads API is not enabled (set GOOGLE_ADS_API_ENABLED=true after configuring credentials).',
      'GOOGLE_ADS_API_NOT_ENABLED'
    );
  }

  const accessToken = await getFreshGoogleAccessToken({ businessId, provider: 'google_ads' });
  const url = buildGoogleAdsApiUrl(`customers/${customerId}/googleAds:searchStream`);
  const res = await axios.post(
    url,
    {
      query:
        "SELECT conversion_action.id, conversion_action.name, conversion_action.type FROM conversion_action WHERE conversion_action.status != 'REMOVED' LIMIT 1",
    },
    {
      headers: buildGoogleAdsHeaders(accessToken, {
        loginCustomerId: ctx.loginCustomerId,
      }),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw createGoogleAdsApiErrorFromResponse(
      res.status,
      res.data,
      'GOOGLE_ADS_OFFLINE_IMPORT_VALIDATION_FAILED',
      {
        label: 'offline conversion import validation',
        action: 'googleAds:searchStream',
        customerIds: [customerId],
      }
    );
  }

  return {
    ok: true,
    message: 'Offline conversion import prerequisites validated (dry run only; no upload performed).',
    source: 'google_ads_api',
  };
}

module.exports = {
  normalizeCustomerId,
  createDiagnosticCampaignBudget: (ctx) =>
    withProviderRateLimit('google_ads', () => createDiagnosticCampaignBudget(ctx)),
  createDiagnosticSearchCampaign: (ctx) =>
    withProviderRateLimit('google_ads', () => createDiagnosticSearchCampaign(ctx)),
  attachDiagnosticLocationTargeting: (ctx) =>
    withProviderRateLimit('google_ads', () => attachDiagnosticLocationTargeting(ctx)),
  attachDiagnosticLanguageTargeting: (ctx) =>
    withProviderRateLimit('google_ads', () => attachDiagnosticLanguageTargeting(ctx)),
  attachDiagnosticAdSchedule: (ctx) =>
    withProviderRateLimit('google_ads', () => attachDiagnosticAdSchedule(ctx)),
  createDiagnosticAdGroup: (ctx) =>
    withProviderRateLimit('google_ads', () => createDiagnosticAdGroup(ctx)),
  createDiagnosticResponsiveSearchAd: (ctx) =>
    withProviderRateLimit('google_ads', () => createDiagnosticResponsiveSearchAd(ctx)),
  addDiagnosticKeyword: (ctx) =>
    withProviderRateLimit('google_ads', () => addDiagnosticKeyword(ctx)),
  createDiagnosticConversionAction: (ctx) =>
    withProviderRateLimit('google_ads', () => createDiagnosticConversionAction(ctx)),
  createDiagnosticSitelinkAsset: (ctx) =>
    withProviderRateLimit('google_ads', () => createDiagnosticSitelinkAsset(ctx)),
  createDiagnosticCalloutAsset: (ctx) =>
    withProviderRateLimit('google_ads', () => createDiagnosticCalloutAsset(ctx)),
  createDiagnosticCallAsset: (ctx) =>
    withProviderRateLimit('google_ads', () => createDiagnosticCallAsset(ctx)),
  createDiagnosticRemarketingUserList: (ctx) =>
    withProviderRateLimit('google_ads', () => createDiagnosticRemarketingUserList(ctx)),
  createDiagnosticNegativeKeywordList: (ctx) =>
    withProviderRateLimit('google_ads', () => createDiagnosticNegativeKeywordList(ctx)),
  validateOfflineConversionImport: (ctx) =>
    withProviderRateLimit('google_ads', () => validateOfflineConversionImport(ctx)),
};
