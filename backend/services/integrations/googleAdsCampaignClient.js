'use strict';

const { MAX_KEYWORD_TEXT_CHARS } = require('../../constants/adsCampaignIntent');
const {
  sanitizeKeywordText,
  isKeywordTextCompliant,
  countKeywordWords,
  MAX_KEYWORD_WORDS,
} = require('../capabilities/googleAdsCampaignComplianceService');
const { withProviderRateLimit } = require('../../lib/providerRateLimit');
const { createLogger } = require('../../lib/observability/logger');
const { resolveGoogleAdsCustomerAuth } = require('./googleAdsCustomerAuth');
const {
  GoogleAdsApiError,
  buildGoogleAdsApiUrl,
  buildGoogleAdsHeaders,
  createGoogleAdsApiErrorFromResponse,
  getGoogleAdsRequestTimeoutMs,
  googleAdsPost,
  normalizeCustomerId,
  parseGoogleAdsApiError,
} = require('./googleAdsApiConfig');

const googleAdsCampaignClientLogger = createLogger({ name: 'googleAdsCampaignClient' });

/**
 * @param {string} customerId — digits only
 * @param {string} collection — e.g. campaignBudgets
 * @param {string} logicalKey
 */
function mockResourceName(customerId, collection, logicalKey) {
  return `customers/${customerId}/${collection}/${logicalKey}`;
}

/**
 * @param {string} prefix
 * @param {string} setupRunId
 * @param {'recommended' | 'alternative' | undefined | null} [slot]
 */
function providerLogicalKey(prefix, setupRunId, slot = 'recommended') {
  if (!slot || slot === 'recommended') {
    return `${prefix}-${setupRunId}`;
  }
  return `${prefix}-${setupRunId}-${slot}`;
}

/**
 * @param {string} setupRunId
 * @param {'recommended' | 'alternative' | undefined | null} [slot]
 * @param {number | null | undefined} [regenerationNumber]
 */
function responsiveSearchAdLogicalKey(setupRunId, slot = 'recommended', regenerationNumber) {
  const regenSuffix = regenerationNumber != null ? `-regen-${regenerationNumber}` : '';
  if (!slot || slot === 'recommended') {
    return `zug-ad-${setupRunId}${regenSuffix}`;
  }
  return `zug-ad-${setupRunId}-${slot}${regenSuffix}`;
}

/**
 * @param {string} setupRunId
 * @param {number} keywordIndex
 * @param {'recommended' | 'alternative' | undefined | null} [slot]
 */
function keywordLogicalKey(setupRunId, keywordIndex, slot = 'recommended') {
  if (!slot || slot === 'recommended') {
    return `zug-kw-${setupRunId}-${keywordIndex}`;
  }
  return `zug-kw-${setupRunId}-${slot}-${keywordIndex}`;
}

/**
 * @param {string} setupRunId
 * @param {number} geoIndex
 * @param {'recommended' | 'alternative' | undefined | null} [slot]
 */
function geoLogicalKey(setupRunId, geoIndex, slot = 'recommended') {
  if (!slot || slot === 'recommended') {
    return `zug-geo-${setupRunId}-${geoIndex}`;
  }
  return `zug-geo-${setupRunId}-${slot}-${geoIndex}`;
}

/**
 * GAQL to find a campaign budget by exact name.
 *
 * @param {string} budgetName
 */
function buildFindBudgetByNameQuery(budgetName) {
  const escaped = escapeGaqlLiteral(budgetName);
  return [
    'SELECT campaign_budget.resource_name, campaign_budget.name',
    'FROM campaign_budget',
    `WHERE campaign_budget.name = '${escaped}'`,
    'LIMIT 1',
  ].join('\n');
}

/**
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 * @param {string} ctx.customerId
 * @param {string} ctx.budgetName
 * @returns {Promise<string | null>}
 */
async function findExistingBudgetResourceNameByName(ctx) {
  const { businessId, customerId: customerIdInput, budgetName } = ctx;
  const customerId = normalizeCustomerId(customerIdInput);
  if (!customerId || !String(budgetName ?? '').trim()) {
    return null;
  }

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(businessId, customerId);
  const url = buildGoogleAdsApiUrl(`customers/${customerId}/googleAds:search`);
  const res = await googleAdsPost(
    url,
    { query: buildFindBudgetByNameQuery(budgetName) },
    {
      headers: buildGoogleAdsHeaders(accessToken, headerOpts),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw createGoogleAdsApiErrorFromResponse(
      res.status,
      res.data,
      'GOOGLE_ADS_BUDGET_SEARCH_FAILED',
      {
        label: 'Google Ads budget search by name',
        action: 'googleAds:search',
        customerIds: [customerId],
      }
    );
  }

  const results = Array.isArray(res.data?.results) ? res.data.results : [];
  const resourceName = results[0]?.campaignBudget?.resourceName;
  return typeof resourceName === 'string' && resourceName.trim() ? resourceName.trim() : null;
}

/**
 * @param {object} ctx
 * @param {string} ctx.customerId
 * @param {string} ctx.setupRunId
 * @param {object} ctx.intent
 */
async function createCampaignBudget(ctx) {
  const { customerId, setupRunId, intent, slot = 'recommended' } = ctx;
  const logicalKey = providerLogicalKey('zug-budget', setupRunId, slot);
  const budget = intent.campaign?.budget ?? intent.budget;

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

  const normalizedCustomerId = normalizeCustomerId(customerId);
  const budgetName = budget?.name;
  const existingResourceName = await findExistingBudgetResourceNameByName({
    businessId: ctx.businessId,
    customerId: normalizedCustomerId,
    budgetName,
  });
  if (existingResourceName) {
    return { resourceName: existingResourceName, source: 'google_ads_api_reused' };
  }

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(ctx.businessId, normalizedCustomerId);

  const url = buildGoogleAdsApiUrl(`customers/${normalizedCustomerId}/campaignBudgets:mutate`);
  const res = await googleAdsPost(
    url,
    {
      operations: [
        {
          create: {
            name: budget.name,
            amountMicros: String(budget.amountMicros),
            deliveryMethod: 'STANDARD',
            explicitlyShared: false,
          },
        },
      ],
    },
    {
      headers: buildGoogleAdsHeaders(accessToken, headerOpts),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  const resourceName = extractMutateResourceName(res, 'campaign budget', customerId);
  return { resourceName, source: 'google_ads_api' };
}

const RSA_MIN_HEADLINES = 3;
const RSA_MAX_HEADLINES = 15;
const RSA_MIN_DESCRIPTIONS = 2;
const RSA_MAX_DESCRIPTIONS = 4;
const RSA_HEADLINE_MAX_CHARS = 30;
const RSA_DESCRIPTION_MAX_CHARS = 90;

/**
 * @param {string | undefined | null} text
 * @param {number} maxChars
 */
function truncateRsaText(text, maxChars) {
  const trimmed = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.length <= maxChars ? trimmed : trimmed.slice(0, maxChars).trim();
}

/**
 * @param {string[]} candidates
 * @param {number} maxChars
 * @param {number} maxCount
 */
function collectUniqueRsaTexts(candidates, maxChars, maxCount) {
  const seen = new Set();
  const result = [];

  for (const raw of candidates) {
    const text = truncateRsaText(raw, maxChars);
    if (!text) {
      continue;
    }

    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(text);
    if (result.length >= maxCount) {
      break;
    }
  }

  return result;
}

/**
 * Builds a valid Responsive Search Ad create payload for AdGroupAdService (API v24).
 *
 * @param {{
 *   adGroupResourceName: string,
 *   finalUrl: string,
 *   headlines?: string[],
 *   descriptions?: string[],
 *   fallbacks?: { businessName?: string },
 *   status?: string,
 *   strict?: boolean,
 * }} input
 */
function buildResponsiveSearchAdCreatePayload(input) {
  const finalUrl = String(input.finalUrl ?? '').trim();
  if (!finalUrl) {
    throw new GoogleAdsApiError('Responsive search ad requires a final URL.', 'GOOGLE_ADS_RSA_INVALID');
  }

  let headlines = collectUniqueRsaTexts(input.headlines ?? [], RSA_HEADLINE_MAX_CHARS, RSA_MAX_HEADLINES);
  let descriptions = collectUniqueRsaTexts(
    input.descriptions ?? [],
    RSA_DESCRIPTION_MAX_CHARS,
    RSA_MAX_DESCRIPTIONS
  );

  if (!input.strict) {
    const businessName = truncateRsaText(input.fallbacks?.businessName, RSA_HEADLINE_MAX_CHARS);
    const headlineFallbacks = [
      businessName,
      'Learn More Today',
      'Contact Us Now',
      'Get Started Today',
    ];
    const descriptionFallbacks = [
      businessName ? `Visit ${businessName} online today.` : null,
      'Visit our website to learn more.',
      'Contact us today for more information.',
    ].filter(Boolean);

    if (headlines.length < RSA_MIN_HEADLINES) {
      headlines = collectUniqueRsaTexts(
        [...headlines, ...headlineFallbacks],
        RSA_HEADLINE_MAX_CHARS,
        RSA_MAX_HEADLINES
      );
    }

    if (descriptions.length < RSA_MIN_DESCRIPTIONS) {
      descriptions = collectUniqueRsaTexts(
        [...descriptions, ...descriptionFallbacks],
        RSA_DESCRIPTION_MAX_CHARS,
        RSA_MAX_DESCRIPTIONS
      );
    }
  }

  if (headlines.length < RSA_MIN_HEADLINES || descriptions.length < RSA_MIN_DESCRIPTIONS) {
    throw new GoogleAdsApiError(
      `Responsive search ad requires at least ${RSA_MIN_HEADLINES} headlines and ${RSA_MIN_DESCRIPTIONS} descriptions.`,
      'GOOGLE_ADS_RSA_INVALID'
    );
  }

  return {
    adGroup: input.adGroupResourceName,
    status: input.status ?? 'PAUSED',
    ad: {
      responsiveSearchAd: {
        headlines: headlines.map((text) => ({ text })),
        descriptions: descriptions.map((text) => ({ text })),
      },
      finalUrls: [finalUrl],
    },
  };
}

/**
 * Paused SEARCH campaign payload aligned with dev OAuth lab / creation diagnostics
 * (manual CPC — maximizeConversions `{}` is rejected by Google Ads API v24).
 *
 * @param {{ name: string, campaignBudget: string }} input
 */
function buildSearchCampaignCreatePayload(input) {
  return {
    name: input.name,
    advertisingChannelType: 'SEARCH',
    status: 'PAUSED',
    campaignBudget: input.campaignBudget,
    containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
    manualCpc: {
      enhancedCpcEnabled: false,
    },
    networkSettings: {
      targetGoogleSearch: true,
      targetSearchNetwork: true,
      targetContentNetwork: false,
    },
  };
}

/**
 * Escape single quotes and backslashes for GAQL string literals.
 *
 * @param {string} value
 */
function escapeGaqlLiteral(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * GAQL to find an active/paused SEARCH campaign by exact name.
 *
 * @param {string} campaignName
 */
function buildFindCampaignByNameQuery(campaignName) {
  const escaped = escapeGaqlLiteral(campaignName);
  return [
    'SELECT campaign.resource_name, campaign.name, campaign.status, campaign.advertising_channel_type',
    'FROM campaign',
    `WHERE campaign.name = '${escaped}'`,
    "AND campaign.status IN ('PAUSED', 'ENABLED')",
    "AND campaign.advertising_channel_type = 'SEARCH'",
    'LIMIT 1',
  ].join('\n');
}

/**
 * @param {GoogleAdsApiError} err
 */
function isDuplicateCampaignNameError(err) {
  const violations = err.details?.fieldViolations ?? [];
  if (violations.some((v) => v.description?.includes('DUPLICATE_CAMPAIGN_NAME'))) {
    return true;
  }

  const adsErrors = err.details?.googleAdsErrors ?? [];
  return adsErrors.some(
    (e) =>
      e.errorCode?.includes('DUPLICATE_CAMPAIGN_NAME') ||
      e.message?.includes('DUPLICATE_CAMPAIGN_NAME')
  );
}

/**
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 * @param {string} ctx.customerId — digits only
 * @param {string} ctx.campaignName
 * @returns {Promise<string | null>}
 */
async function findExistingCampaignResourceNameByName(ctx) {
  const { businessId, customerId: customerIdInput, campaignName } = ctx;
  const customerId = normalizeCustomerId(customerIdInput);
  if (!customerId || !String(campaignName ?? '').trim()) {
    return null;
  }

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(businessId, customerId);
  const url = buildGoogleAdsApiUrl(`customers/${customerId}/googleAds:search`);
  const res = await googleAdsPost(
    url,
    { query: buildFindCampaignByNameQuery(campaignName) },
    {
      headers: buildGoogleAdsHeaders(accessToken, headerOpts),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw createGoogleAdsApiErrorFromResponse(
      res.status,
      res.data,
      'GOOGLE_ADS_CAMPAIGN_SEARCH_FAILED',
      {
        label: 'Google Ads campaign search by name',
        action: 'googleAds:search',
        customerIds: [customerId],
      }
    );
  }

  const results = Array.isArray(res.data?.results) ? res.data.results : [];
  const resourceName = results[0]?.campaign?.resourceName;
  return typeof resourceName === 'string' && resourceName.trim() ? resourceName.trim() : null;
}

/**
 * GAQL to find a SEARCH_STANDARD ad group by exact name within a campaign.
 *
 * @param {string} adGroupName
 * @param {string} campaignResourceName
 */
function buildFindAdGroupByNameQuery(adGroupName, campaignResourceName) {
  const escapedName = escapeGaqlLiteral(adGroupName);
  const escapedCampaign = escapeGaqlLiteral(campaignResourceName);
  return [
    'SELECT ad_group.resource_name, ad_group.name, ad_group.status, ad_group.type',
    'FROM ad_group',
    `WHERE ad_group.name = '${escapedName}'`,
    `AND campaign.resource_name = '${escapedCampaign}'`,
    "AND ad_group.type = 'SEARCH_STANDARD'",
    "AND ad_group.status IN ('ENABLED', 'PAUSED')",
    'LIMIT 1',
  ].join('\n');
}

/**
 * @param {GoogleAdsApiError} err
 */
function isDuplicateAdGroupNameError(err) {
  const violations = err.details?.fieldViolations ?? [];
  if (violations.some((v) => v.description?.includes('DUPLICATE_ADGROUP_NAME'))) {
    return true;
  }

  const adsErrors = err.details?.googleAdsErrors ?? [];
  return adsErrors.some(
    (e) =>
      e.errorCode?.includes('DUPLICATE_ADGROUP_NAME') ||
      e.message?.includes('DUPLICATE_ADGROUP_NAME')
  );
}

/**
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 * @param {string} ctx.customerId — digits only
 * @param {string} ctx.adGroupName
 * @param {string} ctx.campaignResourceName
 * @returns {Promise<string | null>}
 */
async function findExistingAdGroupResourceNameByName(ctx) {
  const { businessId, customerId: customerIdInput, adGroupName, campaignResourceName } = ctx;
  const customerId = normalizeCustomerId(customerIdInput);
  if (!customerId || !String(adGroupName ?? '').trim() || !String(campaignResourceName ?? '').trim()) {
    return null;
  }

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(businessId, customerId);
  const url = buildGoogleAdsApiUrl(`customers/${customerId}/googleAds:search`);
  const res = await googleAdsPost(
    url,
    { query: buildFindAdGroupByNameQuery(adGroupName, campaignResourceName) },
    {
      headers: buildGoogleAdsHeaders(accessToken, headerOpts),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw createGoogleAdsApiErrorFromResponse(
      res.status,
      res.data,
      'GOOGLE_ADS_AD_GROUP_SEARCH_FAILED',
      {
        label: 'Google Ads ad group search by name',
        action: 'googleAds:search',
        customerIds: [customerId],
      }
    );
  }

  const results = Array.isArray(res.data?.results) ? res.data.results : [];
  const resourceName = results[0]?.adGroup?.resourceName;
  return typeof resourceName === 'string' && resourceName.trim() ? resourceName.trim() : null;
}

/**
 * @param {object} ctx
 */
async function createCampaign(ctx) {
  const { customerId, setupRunId, intent, budgetResourceName, slot = 'recommended' } = ctx;
  const logicalKey = providerLogicalKey('zug-campaign', setupRunId, slot);

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return {
      resourceName: mockResourceName(customerId, 'campaigns', logicalKey),
      source: 'google_ads_api_mock',
    };
  }

  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    throw new GoogleAdsApiError(
      'Google Ads API is not enabled (set GOOGLE_ADS_API_ENABLED=true after configuring credentials).',
      'GOOGLE_ADS_API_NOT_ENABLED'
    );
  }

  const normalizedCustomerId = normalizeCustomerId(customerId);
  const campaignName = intent.campaign?.name ?? intent.campaignName;
  const lookupCtx = {
    businessId: ctx.businessId,
    customerId: normalizedCustomerId,
    campaignName,
  };

  const existingResourceName = await findExistingCampaignResourceNameByName(lookupCtx);
  if (existingResourceName) {
    return { resourceName: existingResourceName, source: 'google_ads_api_reused' };
  }

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(ctx.businessId, normalizedCustomerId);
  const url = buildGoogleAdsApiUrl(`customers/${normalizedCustomerId}/campaigns:mutate`);
  const res = await googleAdsPost(
    url,
    {
      operations: [
        {
          create: buildSearchCampaignCreatePayload({
            name: campaignName,
            campaignBudget: budgetResourceName,
          }),
        },
      ],
    },
    {
      headers: buildGoogleAdsHeaders(accessToken, headerOpts),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  try {
    const resourceName = extractMutateResourceName(res, 'campaign', normalizedCustomerId);
    return { resourceName, source: 'google_ads_api' };
  } catch (err) {
    if (err instanceof GoogleAdsApiError && isDuplicateCampaignNameError(err)) {
      const recovered = await findExistingCampaignResourceNameByName(lookupCtx);
      if (recovered) {
        return { resourceName: recovered, source: 'google_ads_api_reused' };
      }
    }
    throw err;
  }
}

/**
 * @param {object} ctx
 */
async function createAdGroup(ctx) {
  const { customerId, setupRunId, intent, campaignResourceName, slot = 'recommended' } = ctx;
  const logicalKey = providerLogicalKey('zug-adgroup', setupRunId, slot);

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return {
      resourceName: mockResourceName(customerId, 'adGroups', logicalKey),
      source: 'google_ads_api_mock',
    };
  }

  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    throw new GoogleAdsApiError(
      'Google Ads API is not enabled (set GOOGLE_ADS_API_ENABLED=true after configuring credentials).',
      'GOOGLE_ADS_API_NOT_ENABLED'
    );
  }

  const normalizedCustomerId = normalizeCustomerId(customerId);
  const adGroupName = intent.adGroup?.name ?? intent.adGroupName;
  const lookupCtx = {
    businessId: ctx.businessId,
    customerId: normalizedCustomerId,
    adGroupName,
    campaignResourceName,
  };

  const existingResourceName = await findExistingAdGroupResourceNameByName(lookupCtx);
  if (existingResourceName) {
    return { resourceName: existingResourceName, source: 'google_ads_api_reused' };
  }

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(ctx.businessId, normalizedCustomerId);
  const url = buildGoogleAdsApiUrl(`customers/${normalizedCustomerId}/adGroups:mutate`);
  const res = await googleAdsPost(
    url,
    {
      operations: [
        {
          create: {
            name: adGroupName,
            campaign: campaignResourceName,
            status: 'PAUSED',
            type: 'SEARCH_STANDARD',
          },
        },
      ],
    },
    {
      headers: buildGoogleAdsHeaders(accessToken, headerOpts),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  try {
    const resourceName = extractMutateResourceName(res, 'ad group', normalizedCustomerId);
    return { resourceName, source: 'google_ads_api' };
  } catch (err) {
    if (err instanceof GoogleAdsApiError && isDuplicateAdGroupNameError(err)) {
      const recovered = await findExistingAdGroupResourceNameByName(lookupCtx);
      if (recovered) {
        return { resourceName: recovered, source: 'google_ads_api_reused' };
      }
    }
    throw err;
  }
}

const ALLOWED_KEYWORD_MATCH_TYPES = new Set(['PHRASE', 'EXACT', 'BROAD']);

/**
 * @param {{
 *   adGroupResourceName: string,
 *   keywordText: string,
 *   matchType: string,
 * }} input
 */
function buildAdGroupKeywordCreatePayload(input) {
  const adGroupResourceName = String(input.adGroupResourceName ?? '').trim();
  const sanitized = sanitizeKeywordText(input.keywordText);
  const keywordText = sanitized.text;
  const matchType = String(input.matchType ?? '').trim();

  if (!adGroupResourceName) {
    throw new GoogleAdsApiError('Ad group resource name is required for keyword create.', 'GOOGLE_ADS_KEYWORD_INVALID');
  }
  if (!keywordText) {
    throw new GoogleAdsApiError(
      'Keyword text is required after Google Ads compliance sanitization.',
      'GOOGLE_ADS_KEYWORD_INVALID'
    );
  }
  if (keywordText.length > MAX_KEYWORD_TEXT_CHARS) {
    throw new GoogleAdsApiError(
      `Keyword text must be at most ${MAX_KEYWORD_TEXT_CHARS} characters.`,
      'GOOGLE_ADS_KEYWORD_INVALID'
    );
  }
  if (countKeywordWords(keywordText) > MAX_KEYWORD_WORDS) {
    throw new GoogleAdsApiError(
      `Keyword text must be at most ${MAX_KEYWORD_WORDS} words.`,
      'GOOGLE_ADS_KEYWORD_INVALID'
    );
  }
  if (!isKeywordTextCompliant(keywordText)) {
    throw new GoogleAdsApiError(
      'Keyword text contains invalid characters or symbols.',
      'GOOGLE_ADS_KEYWORD_INVALID'
    );
  }
  if (!ALLOWED_KEYWORD_MATCH_TYPES.has(matchType)) {
    throw new GoogleAdsApiError(
      'Keyword match type must be PHRASE, EXACT, or BROAD.',
      'GOOGLE_ADS_KEYWORD_INVALID'
    );
  }

  return {
    adGroup: adGroupResourceName,
    status: 'PAUSED',
    keyword: {
      text: keywordText,
      matchType,
    },
  };
}

/**
 * @param {string} adGroupResourceName
 * @param {string} keywordText
 * @param {string} matchType
 */
function buildFindKeywordByTextQuery(adGroupResourceName, keywordText, matchType) {
  const escapedGroup = escapeGaqlLiteral(adGroupResourceName);
  const escapedText = escapeGaqlLiteral(keywordText);
  return [
    'SELECT ad_group_criterion.resource_name',
    'FROM ad_group_criterion',
    `WHERE ad_group.resource_name = '${escapedGroup}'`,
    "AND ad_group_criterion.type = 'KEYWORD'",
    `AND ad_group_criterion.keyword.text = '${escapedText}'`,
    `AND ad_group_criterion.keyword.match_type = '${matchType}'`,
    "AND ad_group_criterion.status IN ('ENABLED', 'PAUSED')",
    'LIMIT 1',
  ].join('\n');
}

/**
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 * @param {string} ctx.customerId
 * @param {string} ctx.adGroupResourceName
 * @param {string} ctx.keywordText
 * @param {string} ctx.matchType
 * @returns {Promise<string | null>}
 */
async function findExistingAdGroupKeywordResourceNameByText(ctx) {
  const { businessId, customerId: customerIdInput, adGroupResourceName, keywordText, matchType } = ctx;
  const customerId = normalizeCustomerId(customerIdInput);
  const text = String(keywordText ?? '').trim();
  const mt = String(matchType ?? '').trim();

  if (!customerId || !String(adGroupResourceName ?? '').trim() || !text || !ALLOWED_KEYWORD_MATCH_TYPES.has(mt)) {
    return null;
  }

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(businessId, customerId);
  const url = buildGoogleAdsApiUrl(`customers/${customerId}/googleAds:search`);
  const res = await googleAdsPost(
    url,
    { query: buildFindKeywordByTextQuery(adGroupResourceName, text, mt) },
    {
      headers: buildGoogleAdsHeaders(accessToken, headerOpts),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw createGoogleAdsApiErrorFromResponse(
      res.status,
      res.data,
      'GOOGLE_ADS_KEYWORD_SEARCH_FAILED',
      {
        label: 'Google Ads keyword search by text',
        action: 'googleAds:search',
        customerIds: [customerId],
      }
    );
  }

  const results = Array.isArray(res.data?.results) ? res.data.results : [];
  const resourceName = results[0]?.adGroupCriterion?.resourceName;
  return typeof resourceName === 'string' && resourceName.trim() ? resourceName.trim() : null;
}

/**
 * @param {GoogleAdsApiError} err
 */
function isDuplicateKeywordError(err) {
  const violations = err.details?.fieldViolations ?? [];
  if (violations.some((v) => /DUPLICATE|ALREADY_EXISTS|CRITERION_ALREADY_EXISTS/i.test(v.description ?? ''))) {
    return true;
  }

  const adsErrors = err.details?.googleAdsErrors ?? [];
  return adsErrors.some(
    (e) =>
      /DUPLICATE|ALREADY_EXISTS|CRITERION_ALREADY_EXISTS/i.test(e.errorCode ?? '') ||
      /DUPLICATE|already exists/i.test(e.message ?? '')
  );
}

/**
 * @param {object} ctx
 * @param {string} ctx.adGroupResourceName
 * @param {string} ctx.keywordText
 * @param {string} ctx.matchType
 * @param {number} ctx.keywordIndex
 */
async function createAdGroupKeyword(ctx) {
  const {
    customerId,
    setupRunId,
    adGroupResourceName,
    keywordText,
    matchType,
    keywordIndex,
    slot = 'recommended',
  } = ctx;
  const logicalKey = keywordLogicalKey(setupRunId, keywordIndex, slot);

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return {
      resourceName: mockResourceName(customerId, 'adGroupCriteria', logicalKey),
      source: 'google_ads_api_mock',
    };
  }

  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    throw new GoogleAdsApiError(
      'Google Ads API is not enabled (set GOOGLE_ADS_API_ENABLED=true after configuring credentials).',
      'GOOGLE_ADS_API_NOT_ENABLED'
    );
  }

  const normalizedCustomerId = normalizeCustomerId(customerId);
  const lookupCtx = {
    businessId: ctx.businessId,
    customerId: normalizedCustomerId,
    adGroupResourceName,
    keywordText,
    matchType,
  };

  const existingResourceName = await findExistingAdGroupKeywordResourceNameByText(lookupCtx);
  if (existingResourceName) {
    return { resourceName: existingResourceName, source: 'google_ads_api_reused' };
  }

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(ctx.businessId, normalizedCustomerId);
  const url = buildGoogleAdsApiUrl(`customers/${normalizedCustomerId}/adGroupCriteria:mutate`);
  const res = await googleAdsPost(
    url,
    {
      operations: [
        {
          create: buildAdGroupKeywordCreatePayload({
            adGroupResourceName,
            keywordText,
            matchType,
          }),
        },
      ],
    },
    {
      headers: buildGoogleAdsHeaders(accessToken, headerOpts),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  try {
    const resourceName = extractMutateResourceName(res, 'ad group keyword', normalizedCustomerId);
    return { resourceName, source: 'google_ads_api' };
  } catch (err) {
    if (err instanceof GoogleAdsApiError && isDuplicateKeywordError(err)) {
      const recovered = await findExistingAdGroupKeywordResourceNameByText(lookupCtx);
      if (recovered) {
        return { resourceName: recovered, source: 'google_ads_api_reused' };
      }
    }
    throw err;
  }
}

/**
 * @param {{
 *   campaignResourceName: string,
 *   geoTargetConstant: string,
 * }} input
 */
function buildCampaignGeoTargetCreatePayload(input) {
  const campaignResourceName = String(input.campaignResourceName ?? '').trim();
  const geoTargetConstant = String(input.geoTargetConstant ?? '').trim();

  if (!campaignResourceName) {
    throw new GoogleAdsApiError(
      'Campaign resource name is required for geo target create.',
      'GOOGLE_ADS_GEO_CRITERION_INVALID'
    );
  }
  if (!geoTargetConstant) {
    throw new GoogleAdsApiError(
      'Geo target constant resource name is required.',
      'GOOGLE_ADS_GEO_CRITERION_INVALID'
    );
  }

  return {
    campaign: campaignResourceName,
    location: {
      geoTargetConstant,
    },
  };
}

/**
 * @param {string} campaignResourceName
 * @param {string} geoTargetConstant
 */
function buildFindCampaignGeoTargetQuery(campaignResourceName, geoTargetConstant) {
  const escapedCampaign = escapeGaqlLiteral(campaignResourceName);
  const escapedGeo = escapeGaqlLiteral(geoTargetConstant);
  return [
    'SELECT campaign_criterion.resource_name',
    'FROM campaign_criterion',
    `WHERE campaign.resource_name = '${escapedCampaign}'`,
    "AND campaign_criterion.type = 'LOCATION'",
    `AND campaign_criterion.location.geo_target_constant = '${escapedGeo}'`,
    "AND campaign_criterion.status IN ('ENABLED', 'PAUSED')",
    'LIMIT 1',
  ].join('\n');
}

/**
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 * @param {string} ctx.customerId
 * @param {string} ctx.campaignResourceName
 * @param {string} ctx.geoTargetConstant
 * @returns {Promise<string | null>}
 */
async function findExistingCampaignGeoTargetResourceName(ctx) {
  const { businessId, customerId: customerIdInput, campaignResourceName, geoTargetConstant } = ctx;
  const customerId = normalizeCustomerId(customerIdInput);
  const campaign = String(campaignResourceName ?? '').trim();
  const geo = String(geoTargetConstant ?? '').trim();

  if (!customerId || !campaign || !geo) {
    return null;
  }

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(businessId, customerId);
  const url = buildGoogleAdsApiUrl(`customers/${customerId}/googleAds:search`);
  const res = await googleAdsPost(
    url,
    { query: buildFindCampaignGeoTargetQuery(campaign, geo) },
    {
      headers: buildGoogleAdsHeaders(accessToken, headerOpts),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw createGoogleAdsApiErrorFromResponse(
      res.status,
      res.data,
      'GOOGLE_ADS_GEO_CRITERION_SEARCH_FAILED',
      {
        label: 'Google Ads campaign geo criterion search',
        action: 'googleAds:search',
        customerIds: [customerId],
      }
    );
  }

  const results = Array.isArray(res.data?.results) ? res.data.results : [];
  const resourceName = results[0]?.campaignCriterion?.resourceName;
  return typeof resourceName === 'string' && resourceName.trim() ? resourceName.trim() : null;
}

/**
 * @param {GoogleAdsApiError} err
 */
function isDuplicateCampaignGeoTargetError(err) {
  const violations = err.details?.fieldViolations ?? [];
  if (violations.some((v) => /DUPLICATE|ALREADY_EXISTS|CRITERION_ALREADY_EXISTS/i.test(v.description ?? ''))) {
    return true;
  }

  const adsErrors = err.details?.googleAdsErrors ?? [];
  return adsErrors.some(
    (e) =>
      /DUPLICATE|ALREADY_EXISTS|CRITERION_ALREADY_EXISTS/i.test(e.errorCode ?? '') ||
      /DUPLICATE|already exists/i.test(e.message ?? '')
  );
}

/**
 * @param {object} ctx
 * @param {string} ctx.campaignResourceName
 * @param {string} ctx.geoTargetConstant
 * @param {number} ctx.geoIndex
 */
async function createCampaignGeoTarget(ctx) {
  const { customerId, setupRunId, campaignResourceName, geoTargetConstant, geoIndex, slot = 'recommended' } = ctx;
  const logicalKey = geoLogicalKey(setupRunId, geoIndex, slot);

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return {
      resourceName: mockResourceName(customerId, 'campaignCriteria', logicalKey),
      source: 'google_ads_api_mock',
    };
  }

  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    throw new GoogleAdsApiError(
      'Google Ads API is not enabled (set GOOGLE_ADS_API_ENABLED=true after configuring credentials).',
      'GOOGLE_ADS_API_NOT_ENABLED'
    );
  }

  const normalizedCustomerId = normalizeCustomerId(customerId);
  const lookupCtx = {
    businessId: ctx.businessId,
    customerId: normalizedCustomerId,
    campaignResourceName,
    geoTargetConstant,
  };

  const existingResourceName = await findExistingCampaignGeoTargetResourceName(lookupCtx);
  if (existingResourceName) {
    return { resourceName: existingResourceName, source: 'google_ads_api_reused' };
  }

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(ctx.businessId, normalizedCustomerId);
  const url = buildGoogleAdsApiUrl(`customers/${normalizedCustomerId}/campaignCriteria:mutate`);
  const res = await googleAdsPost(
    url,
    {
      operations: [
        {
          create: buildCampaignGeoTargetCreatePayload({
            campaignResourceName,
            geoTargetConstant,
          }),
        },
      ],
    },
    {
      headers: buildGoogleAdsHeaders(accessToken, headerOpts),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  try {
    const resourceName = extractMutateResourceName(res, 'campaign geo target', normalizedCustomerId);
    return { resourceName, source: 'google_ads_api' };
  } catch (err) {
    if (err instanceof GoogleAdsApiError && isDuplicateCampaignGeoTargetError(err)) {
      const recovered = await findExistingCampaignGeoTargetResourceName(lookupCtx);
      if (recovered) {
        return { resourceName: recovered, source: 'google_ads_api_reused' };
      }
    }
    throw err;
  }
}

/**
 * @param {object} ctx
 */
async function createResponsiveSearchAd(ctx) {
  const { customerId, setupRunId, intent, adGroupResourceName, regenerationNumber, slot = 'recommended' } = ctx;
  const logicalKey = responsiveSearchAdLogicalKey(setupRunId, slot, regenerationNumber);

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return {
      resourceName: mockResourceName(customerId, 'adGroupAds', logicalKey),
      source: 'google_ads_api_mock',
    };
  }

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(ctx.businessId, customerId);
  const url = buildGoogleAdsApiUrl(`customers/${customerId}/adGroupAds:mutate`);
  const res = await googleAdsPost(
    url,
    {
      operations: [
        {
          create: buildResponsiveSearchAdCreatePayload({
            adGroupResourceName,
            finalUrl: intent.ad.finalUrl,
            headlines: intent.ad.headlines,
            descriptions: intent.ad.descriptions,
            strict: true,
          }),
        },
      ],
    },
    {
      headers: buildGoogleAdsHeaders(accessToken, headerOpts),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    const parsed = parseGoogleAdsApiError(res.status, res.data, {
      action: 'adGroupAds:mutate',
      customerIds: [customerId],
    });
    googleAdsCampaignClientLogger.error(
      {
        operation: 'adGroupAds:mutate',
        customerId,
        businessId: ctx.businessId != null ? String(ctx.businessId) : undefined,
        setupRunId,
        status: res.status,
        googleAdsRequestId: parsed.requestId,
        googleAdsErrors: parsed.googleAdsErrors.slice(0, 5),
        fieldViolations: parsed.fieldViolations.slice(0, 5),
        errorMessage: parsed.message,
      },
      'Google Ads ad group ad mutate failed'
    );
  }

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

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(businessId, customerId);
  const url = buildGoogleAdsApiUrl(`customers/${customerId}/campaigns:mutate`);
  const res = await googleAdsPost(
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
      headers: buildGoogleAdsHeaders(accessToken, headerOpts),
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

/**
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 * @param {string} ctx.campaignResourceName
 */
async function enableAdsCampaign(ctx) {
  const { businessId, campaignResourceName } = ctx;

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return { outcome: 'enabled', source: 'google_ads_api_mock' };
  }

  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    return { outcome: 'skipped_api_disabled', source: 'google_ads_api' };
  }

  const customerId = normalizeCustomerId(campaignResourceName.split('/')[1]);
  if (!customerId) {
    throw new GoogleAdsApiError('Invalid campaign resource name for enable.', 'GOOGLE_ADS_ENABLE_INVALID');
  }

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(businessId, customerId);
  const url = buildGoogleAdsApiUrl(`customers/${customerId}/campaigns:mutate`);
  const res = await googleAdsPost(
    url,
    {
      operations: [
        {
          update: {
            resourceName: campaignResourceName,
            status: 'ENABLED',
          },
          updateMask: 'status',
        },
      ],
    },
    {
      headers: buildGoogleAdsHeaders(accessToken, headerOpts),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw createGoogleAdsApiErrorFromResponse(
      res.status,
      res.data,
      'GOOGLE_ADS_ENABLE_FAILED',
      { label: 'Google Ads campaign enable', action: 'campaigns:mutate', customerIds: [customerId] }
    );
  }

  return { outcome: 'enabled', source: 'google_ads_api' };
}

/**
 * @param {string} campaignResourceName
 */
function buildGetCampaignByResourceNameQuery(campaignResourceName) {
  const escaped = escapeGaqlLiteral(campaignResourceName);
  return [
    'SELECT campaign.resource_name, campaign.status, campaign.campaign_budget, campaign_budget.amount_micros',
    'FROM campaign',
    `WHERE campaign.resource_name = '${escaped}'`,
    'LIMIT 1',
  ].join('\n');
}

/**
 * @param {string} budgetResourceName
 * @returns {boolean}
 */
function isCampaignBudgetResourceName(budgetResourceName) {
  return /^customers\/\d+\/campaignBudgets\/\d+$/.test(String(budgetResourceName ?? '').trim());
}

/**
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 * @param {string} ctx.campaignResourceName
 * @returns {Promise<{ status: string, budgetResourceName: string | null, amountMicros: number | null, source: string }>}
 */
async function getAdsCampaignLiveState(ctx) {
  const { businessId, campaignResourceName } = ctx;

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return {
      status: 'PAUSED',
      budgetResourceName: mockResourceName(
        normalizeCustomerId(campaignResourceName.split('/')[1]) ?? '0',
        'campaignBudgets',
        'mock'
      ),
      amountMicros: 10_000_000,
      source: 'google_ads_api_mock',
    };
  }

  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    return {
      status: 'UNKNOWN',
      budgetResourceName: null,
      amountMicros: null,
      source: 'google_ads_api_disabled',
    };
  }

  const customerId = normalizeCustomerId(campaignResourceName.split('/')[1]);
  if (!customerId) {
    throw new GoogleAdsApiError(
      'Invalid campaign resource name for live state lookup.',
      'GOOGLE_ADS_CAMPAIGN_STATE_INVALID'
    );
  }

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(businessId, customerId);
  const url = buildGoogleAdsApiUrl(`customers/${customerId}/googleAds:search`);
  const res = await googleAdsPost(
    url,
    { query: buildGetCampaignByResourceNameQuery(campaignResourceName) },
    {
      headers: buildGoogleAdsHeaders(accessToken, headerOpts),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw createGoogleAdsApiErrorFromResponse(
      res.status,
      res.data,
      'GOOGLE_ADS_CAMPAIGN_STATE_FAILED',
      {
        label: 'Google Ads campaign live state',
        action: 'googleAds:search',
        customerIds: [customerId],
      }
    );
  }

  const row = Array.isArray(res.data?.results) ? res.data.results[0] : null;
  const status = typeof row?.campaign?.status === 'string' ? row.campaign.status : 'UNKNOWN';
  const budgetResourceName =
    typeof row?.campaign?.campaignBudget === 'string' ? row.campaign.campaignBudget : null;
  const amountMicrosRaw = row?.campaignBudget?.amountMicros;
  const amountMicros =
    amountMicrosRaw != null && Number.isFinite(Number(amountMicrosRaw))
      ? Number(amountMicrosRaw)
      : null;

  return {
    status,
    budgetResourceName,
    amountMicros,
    source: 'google_ads_api',
  };
}

/**
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 * @param {string} ctx.budgetResourceName — customers/{cid}/campaignBudgets/{id}
 * @param {number} ctx.amountMicros
 */
async function updateCampaignBudget(ctx) {
  const { businessId, budgetResourceName, amountMicros } = ctx;
  const normalizedBudget = String(budgetResourceName ?? '').trim();

  if (!isCampaignBudgetResourceName(normalizedBudget)) {
    throw new GoogleAdsApiError(
      'Invalid campaign budget resource name for update.',
      'GOOGLE_ADS_BUDGET_UPDATE_INVALID'
    );
  }

  const parsedAmount = Number(amountMicros);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new GoogleAdsApiError(
      'Campaign budget amountMicros must be a positive number.',
      'GOOGLE_ADS_BUDGET_UPDATE_INVALID'
    );
  }

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return { outcome: 'updated', amountMicros: parsedAmount, source: 'google_ads_api_mock' };
  }

  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    return { outcome: 'skipped_api_disabled', source: 'google_ads_api' };
  }

  const customerId = normalizeCustomerId(normalizedBudget.split('/')[1]);
  if (!customerId) {
    throw new GoogleAdsApiError(
      'Invalid campaign budget resource name for update.',
      'GOOGLE_ADS_BUDGET_UPDATE_INVALID'
    );
  }

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(businessId, customerId);
  const url = buildGoogleAdsApiUrl(`customers/${customerId}/campaignBudgets:mutate`);
  const res = await googleAdsPost(
    url,
    {
      operations: [
        {
          update: {
            resourceName: normalizedBudget,
            amountMicros: String(parsedAmount),
          },
          updateMask: 'amountMicros',
        },
      ],
    },
    {
      headers: buildGoogleAdsHeaders(accessToken, headerOpts),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw createGoogleAdsApiErrorFromResponse(
      res.status,
      res.data,
      'GOOGLE_ADS_BUDGET_UPDATE_FAILED',
      {
        label: 'Google Ads campaign budget update',
        action: 'campaignBudgets:mutate',
        customerIds: [customerId],
      }
    );
  }

  return { outcome: 'updated', amountMicros: parsedAmount, source: 'google_ads_api' };
}

/**
 * @param {string} campaignResourceName
 * @returns {string}
 */
function extractCampaignIdFromResourceName(campaignResourceName) {
  const campaignId = String(campaignResourceName ?? '').split('/')[3];
  if (!campaignId) {
    throw new GoogleAdsApiError('Invalid campaign resource name.', 'GOOGLE_ADS_GOAL_INVALID');
  }
  return campaignId;
}

/**
 * @param {string} customerId
 * @param {string | null | undefined} conversionResourceName
 * @param {string | number} conversionExternalId
 * @returns {string}
 */
function resolveConversionActionResourceName(customerId, conversionResourceName, conversionExternalId) {
  const fromMetadata = String(conversionResourceName ?? '').trim();
  if (fromMetadata.startsWith('customers/')) {
    return fromMetadata;
  }

  const externalId = String(conversionExternalId ?? '').replace(/\D/g, '');
  if (!externalId) {
    throw new GoogleAdsApiError(
      'Conversion action resource name or externalId is required for goal linkage.',
      'GOOGLE_ADS_GOAL_INVALID'
    );
  }

  return `customers/${customerId}/conversionActions/${externalId}`;
}

/**
 * @param {{
 *   name: string,
 *   conversionActionResourceNames: string[],
 *   status?: string,
 * }} input
 */
function buildCustomConversionGoalCreatePayload(input) {
  const conversionActionResourceNames = Array.isArray(input.conversionActionResourceNames)
    ? input.conversionActionResourceNames.filter(Boolean)
    : [];

  if (conversionActionResourceNames.length < 1) {
    throw new GoogleAdsApiError(
      'Custom conversion goal requires at least one conversion action.',
      'GOOGLE_ADS_GOAL_INVALID'
    );
  }

  return {
    name: input.name,
    conversionActions: conversionActionResourceNames,
    status: input.status ?? 'ENABLED',
  };
}

/**
 * @param {{
 *   customerId: string,
 *   campaignResourceName: string,
 *   customConversionGoalResourceName: string,
 * }} input
 */
function buildConversionGoalCampaignConfigUpdateOperation(input) {
  const campaignId = extractCampaignIdFromResourceName(input.campaignResourceName);

  return {
    update: {
      resourceName: `customers/${input.customerId}/conversionGoalCampaignConfigs/${campaignId}`,
      customConversionGoal: input.customConversionGoalResourceName,
    },
    updateMask: 'custom_conversion_goal',
  };
}

/**
 * GAQL to find a custom conversion goal by exact name.
 *
 * @param {string} goalName
 */
function buildFindCustomConversionGoalByNameQuery(goalName) {
  const escaped = escapeGaqlLiteral(goalName);
  return [
    'SELECT custom_conversion_goal.resource_name, custom_conversion_goal.name',
    'FROM custom_conversion_goal',
    `WHERE custom_conversion_goal.name = '${escaped}'`,
    'LIMIT 1',
  ].join('\n');
}

/**
 * @param {GoogleAdsApiError} err
 */
function isCustomGoalDuplicateNameError(err) {
  const googleAdsErrors = err?.details?.googleAdsErrors ?? [];
  const message = String(err?.message ?? '');

  const family = 'customConversionGoalError';
  const value = 'CUSTOM_GOAL_DUPLICATE_NAME';

  const structured = googleAdsErrors.some((e) => {
    const code = String(e?.errorCode ?? '');
    return code.includes(`${family}:${value}`);
  });

  const scopedFallback = message.includes(`${family}:${value}`);

  return structured || scopedFallback;
}

/**
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 * @param {string} ctx.customerId
 * @param {string} ctx.goalName
 * @returns {Promise<string | null>}
 */
async function findExistingCustomConversionGoalResourceNameByName(ctx) {
  const { businessId, customerId: customerIdInput, goalName } = ctx;
  const customerId = normalizeCustomerId(customerIdInput);
  if (!customerId || !String(goalName ?? '').trim()) {
    return null;
  }

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(businessId, customerId);
  const url = buildGoogleAdsApiUrl(`customers/${customerId}/googleAds:search`);
  const res = await googleAdsPost(
    url,
    { query: buildFindCustomConversionGoalByNameQuery(goalName) },
    {
      headers: buildGoogleAdsHeaders(accessToken, headerOpts),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw createGoogleAdsApiErrorFromResponse(
      res.status,
      res.data,
      'GOOGLE_ADS_CUSTOM_CONVERSION_GOAL_SEARCH_FAILED',
      {
        label: 'Google Ads custom conversion goal search by name',
        action: 'googleAds:search',
        customerIds: [customerId],
      }
    );
  }

  const results = Array.isArray(res.data?.results) ? res.data.results : [];
  const resourceName = results[0]?.customConversionGoal?.resourceName;
  return typeof resourceName === 'string' && resourceName.trim() ? resourceName.trim() : null;
}

/**
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 * @param {string} ctx.customerId
 * @param {string} ctx.setupRunId
 * @param {string} ctx.name
 * @param {string[]} ctx.conversionActionResourceNames
 */
async function createCustomConversionGoal(ctx) {
  const { customerId, setupRunId, name, conversionActionResourceNames, slot = 'recommended' } = ctx;
  const logicalKey = providerLogicalKey('zug-custom-goal', setupRunId, slot);

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return {
      resourceName: mockResourceName(customerId, 'customConversionGoals', logicalKey),
      source: 'google_ads_api_mock',
    };
  }

  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    return {
      resourceName: `customers/${customerId}/customConversionGoals/${logicalKey}`,
      source: 'google_ads_local_record',
    };
  }

  const normalizedCustomerId = normalizeCustomerId(customerId);
  const lookupCtx = {
    businessId: ctx.businessId,
    customerId: normalizedCustomerId,
    goalName: name,
  };

  const existingResourceName = await findExistingCustomConversionGoalResourceNameByName(lookupCtx);
  if (existingResourceName) {
    return { resourceName: existingResourceName, source: 'google_ads_api_reused' };
  }

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(ctx.businessId, normalizedCustomerId);
  const url = buildGoogleAdsApiUrl(`customers/${normalizedCustomerId}/customConversionGoals:mutate`);
  const res = await googleAdsPost(
    url,
    {
      operations: [
        {
          create: buildCustomConversionGoalCreatePayload({
            name,
            conversionActionResourceNames,
          }),
        },
      ],
    },
    {
      headers: buildGoogleAdsHeaders(accessToken, headerOpts),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  try {
    const resourceName = extractMutateResourceName(res, 'custom conversion goal', normalizedCustomerId);
    return { resourceName, source: 'google_ads_api' };
  } catch (err) {
    if (err instanceof GoogleAdsApiError && isCustomGoalDuplicateNameError(err)) {
      const recovered = await findExistingCustomConversionGoalResourceNameByName(lookupCtx);
      if (recovered) {
        return { resourceName: recovered, source: 'google_ads_api_reused' };
      }
    }
    throw err;
  }
}

/**
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 * @param {string} ctx.customerId
 * @param {string} ctx.campaignResourceName
 * @param {string} ctx.customConversionGoalResourceName
 */
async function linkCampaignToCustomConversionGoal(ctx) {
  const { customerId, setupRunId, campaignResourceName, customConversionGoalResourceName, slot = 'recommended' } = ctx;
  const campaignId = extractCampaignIdFromResourceName(campaignResourceName);
  const logicalKey = providerLogicalKey(`zug-goal-config-${campaignId}`, setupRunId, slot);

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return {
      resourceName: mockResourceName(customerId, 'conversionGoalCampaignConfigs', logicalKey),
      source: 'google_ads_api_mock',
    };
  }

  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    return {
      resourceName: `customers/${customerId}/conversionGoalCampaignConfigs/${campaignId}`,
      source: 'google_ads_local_record',
    };
  }

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(ctx.businessId, customerId);
  const url = buildGoogleAdsApiUrl(`customers/${customerId}/conversionGoalCampaignConfigs:mutate`);
  const res = await googleAdsPost(
    url,
    {
      operations: [
        buildConversionGoalCampaignConfigUpdateOperation({
          customerId,
          campaignResourceName,
          customConversionGoalResourceName,
        }),
      ],
    },
    {
      headers: buildGoogleAdsHeaders(accessToken, headerOpts),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  const resourceName = extractMutateResourceName(res, 'conversion goal campaign config', customerId);
  return { resourceName, source: 'google_ads_api' };
}

/**
 * Production call asset linked to AD_CALL conversion action.
 *
 * @param {object} ctx
 */
async function createCallAsset(ctx) {
  const {
    businessId,
    customerId,
    setupRunId,
    campaignResourceName,
    phoneNumber,
    countryCode = 'US',
    conversionActionResourceName,
    slot = 'recommended',
  } = ctx;

  if (!conversionActionResourceName) {
    throw new GoogleAdsApiError(
      'Call conversion action resource is required before creating call asset.',
      'ADS_CALL_CONVERSION_REQUIRED'
    );
  }

  const resourceLabel = providerLogicalKey('zug-call', setupRunId, slot);

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    const assetResourceName = mockResourceName(customerId, 'assets', resourceLabel);
    return {
      assetResourceName,
      campaignAssetResourceName: mockResourceName(customerId, 'campaignAssets', `${resourceLabel}-link`),
      source: 'google_ads_api_mock',
    };
  }

  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    throw new GoogleAdsApiError('Google Ads API is not enabled.', 'GOOGLE_ADS_API_NOT_ENABLED');
  }

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(businessId, customerId);

  const assetRes = await googleAdsPost(
    buildGoogleAdsApiUrl(`customers/${customerId}/assets:mutate`),
    {
      operations: [
        {
          create: {
            callAsset: {
              countryCode,
              phoneNumber,
              callConversionAction: conversionActionResourceName,
            },
          },
        },
      ],
    },
    {
      headers: buildGoogleAdsHeaders(accessToken, headerOpts),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  const assetResourceName = extractMutateResourceName(assetRes, 'call asset', customerId);
  const linkResult = await linkCallAssetToCampaign({
    businessId,
    customerId,
    campaignResourceName,
    assetResourceName,
    setupRunId,
    slot,
  });

  return {
    assetResourceName,
    campaignAssetResourceName: linkResult.campaignAssetResourceName,
    source: 'google_ads_api',
  };
}

/**
 * Create call asset only (no campaign link).
 *
 * @param {object} ctx
 */
async function createCallAssetOnly(ctx) {
  const {
    businessId,
    customerId,
    setupRunId,
    phoneNumber,
    countryCode = 'US',
    conversionActionResourceName,
    slot = 'recommended',
  } = ctx;

  if (!conversionActionResourceName) {
    throw new GoogleAdsApiError(
      'Call conversion action resource is required before creating call asset.',
      'ADS_CALL_CONVERSION_REQUIRED'
    );
  }

  const resourceLabel = providerLogicalKey('zug-call', setupRunId, slot);

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return {
      assetResourceName: mockResourceName(customerId, 'assets', resourceLabel),
      source: 'google_ads_api_mock',
    };
  }

  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    throw new GoogleAdsApiError('Google Ads API is not enabled.', 'GOOGLE_ADS_API_NOT_ENABLED');
  }

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(businessId, customerId);
  const assetRes = await googleAdsPost(
    buildGoogleAdsApiUrl(`customers/${customerId}/assets:mutate`),
    {
      operations: [
        {
          create: {
            callAsset: {
              countryCode,
              phoneNumber,
              callConversionAction: conversionActionResourceName,
            },
          },
        },
      ],
    },
    {
      headers: buildGoogleAdsHeaders(accessToken, headerOpts),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  const assetResourceName = extractMutateResourceName(assetRes, 'call asset', customerId);
  return { assetResourceName, source: 'google_ads_api' };
}

/**
 * Link an existing call asset to a campaign.
 *
 * @param {object} ctx
 */
async function linkCallAssetToCampaign(ctx) {
  const { businessId, customerId, campaignResourceName, assetResourceName, setupRunId, slot = 'recommended' } =
    ctx;
  const resourceLabel = providerLogicalKey('zug-call', setupRunId, slot);

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return {
      campaignAssetResourceName: mockResourceName(customerId, 'campaignAssets', `${resourceLabel}-link`),
      source: 'google_ads_api_mock',
    };
  }

  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    throw new GoogleAdsApiError('Google Ads API is not enabled.', 'GOOGLE_ADS_API_NOT_ENABLED');
  }

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(businessId, customerId);
  await googleAdsPost(
    buildGoogleAdsApiUrl(`customers/${customerId}/campaignAssets:mutate`),
    {
      operations: [
        {
          create: {
            campaign: campaignResourceName,
            asset: assetResourceName,
            fieldType: 'CALL',
          },
        },
      ],
    },
    {
      headers: buildGoogleAdsHeaders(accessToken, headerOpts),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  return { campaignAssetResourceName: null, source: 'google_ads_api' };
}

module.exports = {
  mockResourceName,
  escapeGaqlLiteral,
  buildFindCampaignByNameQuery,
  buildFindAdGroupByNameQuery,
  buildFindKeywordByTextQuery,
  buildFindCampaignGeoTargetQuery,
  buildAdGroupKeywordCreatePayload,
  buildCampaignGeoTargetCreatePayload,
  buildResponsiveSearchAdCreatePayload,
  buildSearchCampaignCreatePayload,
  buildCustomConversionGoalCreatePayload,
  buildConversionGoalCampaignConfigUpdateOperation,
  buildFindCustomConversionGoalByNameQuery,
  resolveConversionActionResourceName,
  truncateRsaText,
  createCampaignBudget: (ctx) => withProviderRateLimit('google_ads', () => createCampaignBudget(ctx)),
  createCampaign: (ctx) => withProviderRateLimit('google_ads', () => createCampaign(ctx)),
  createAdGroup: (ctx) => withProviderRateLimit('google_ads', () => createAdGroup(ctx)),
  createAdGroupKeyword: (ctx) => withProviderRateLimit('google_ads', () => createAdGroupKeyword(ctx)),
  createCampaignGeoTarget: (ctx) => withProviderRateLimit('google_ads', () => createCampaignGeoTarget(ctx)),
  createResponsiveSearchAd: (ctx) => withProviderRateLimit('google_ads', () => createResponsiveSearchAd(ctx)),
  createCustomConversionGoal: (ctx) =>
    withProviderRateLimit('google_ads', () => createCustomConversionGoal(ctx)),
  linkCampaignToCustomConversionGoal: (ctx) =>
    withProviderRateLimit('google_ads', () => linkCampaignToCustomConversionGoal(ctx)),
  pauseAdsCampaign: (ctx) => withProviderRateLimit('google_ads', () => pauseAdsCampaign(ctx)),
  enableAdsCampaign: (ctx) => withProviderRateLimit('google_ads', () => enableAdsCampaign(ctx)),
  getAdsCampaignLiveState: (ctx) =>
    withProviderRateLimit('google_ads', () => getAdsCampaignLiveState(ctx)),
  updateCampaignBudget: (ctx) => withProviderRateLimit('google_ads', () => updateCampaignBudget(ctx)),
  createCallAsset: (ctx) => withProviderRateLimit('google_ads', () => createCallAsset(ctx)),
  createCallAssetOnly: (ctx) => withProviderRateLimit('google_ads', () => createCallAssetOnly(ctx)),
  linkCallAssetToCampaign: (ctx) => withProviderRateLimit('google_ads', () => linkCallAssetToCampaign(ctx)),
  isCampaignBudgetResourceName,
};
