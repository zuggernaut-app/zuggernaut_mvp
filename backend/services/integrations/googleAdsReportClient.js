'use strict';

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
} = require('./googleAdsApiConfig');

const log = createLogger({ name: 'googleAdsReportClient' });

/**
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 * @param {string} ctx.customerId
 * @param {string} ctx.campaignResourceName
 */
async function fetchCampaignPerformanceMetrics(ctx) {
  const { businessId, customerId, campaignResourceName } = ctx;
  const normalizedCustomerId = normalizeCustomerId(customerId);
  if (!normalizedCustomerId) {
    throw new GoogleAdsApiError('Invalid Google Ads customer id.', 'GOOGLE_ADS_INVALID_CUSTOMER');
  }

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return {
      impressions: 1200,
      clicks: 84,
      costMicros: 45_000_000,
      conversions: 6,
      dateRangeDays: 30,
      source: 'google_ads_api_mock',
    };
  }

  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    throw new GoogleAdsApiError(
      'Google Ads API is not enabled (set GOOGLE_ADS_API_ENABLED=true after configuring credentials).',
      'GOOGLE_ADS_API_NOT_ENABLED'
    );
  }

  const query = `
    SELECT
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions
    FROM campaign
    WHERE campaign.resource_name = '${campaignResourceName.replace(/'/g, "\\'")}'
      AND segments.date DURING LAST_30_DAYS
  `;

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(businessId, normalizedCustomerId);
  const url = buildGoogleAdsApiUrl(`customers/${normalizedCustomerId}/googleAds:search`);
  const res = await withProviderRateLimit('google_ads', () =>
    googleAdsPost(
      url,
      { query },
      {
        headers: buildGoogleAdsHeaders(accessToken, headerOpts),
        timeout: getGoogleAdsRequestTimeoutMs(),
        validateStatus: () => true,
      }
    )
  );

  if (res.status < 200 || res.status >= 300) {
    throw await createGoogleAdsApiErrorFromResponse(
      res.status,
      res.data,
      'GOOGLE_ADS_PERFORMANCE_QUERY_FAILED',
      { label: 'Google Ads campaign performance', action: 'googleAds:search' }
    );
  }

  let impressions = 0;
  let clicks = 0;
  let costMicros = 0;
  let conversions = 0;

  const rows = Array.isArray(res.data?.results) ? res.data.results : [];
  for (const row of rows) {
    const metrics = row?.metrics ?? {};
    impressions += Number(metrics.impressions ?? 0);
    clicks += Number(metrics.clicks ?? 0);
    costMicros += Number(metrics.costMicros ?? metrics.cost_micros ?? 0);
    conversions += Number(metrics.conversions ?? 0);
  }

  log.info(
    {
      businessId: businessId.toString(),
      customerId: normalizedCustomerId,
      campaignResourceName,
      impressions,
      clicks,
    },
    'google_ads.performance.fetched'
  );

  return {
    impressions,
    clicks,
    costMicros,
    conversions,
    dateRangeDays: 30,
    source: 'google_ads_api',
  };
}

/**
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 * @param {string} ctx.customerId
 * @param {string} ctx.adResourceName
 */
async function fetchAdPolicyStatus(ctx) {
  const { businessId, customerId, adResourceName } = ctx;
  const normalizedCustomerId = normalizeCustomerId(customerId);
  if (!normalizedCustomerId || !adResourceName) {
    throw new GoogleAdsApiError('Invalid ad policy query input.', 'GOOGLE_ADS_INVALID_AD');
  }

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return {
      approvalStatus: 'APPROVED',
      policyTopic: null,
      source: 'google_ads_api_mock',
    };
  }

  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    throw new GoogleAdsApiError('Google Ads API is not enabled.', 'GOOGLE_ADS_API_NOT_ENABLED');
  }

  const escaped = String(adResourceName).replace(/'/g, "\\'");
  const query = `
    SELECT
      ad_group_ad.policy_summary.approval_status,
      ad_group_ad.policy_summary.policy_topic_entries
    FROM ad_group_ad
    WHERE ad_group_ad.resource_name = '${escaped}'
    LIMIT 1
  `;

  const { accessToken, headerOpts } = await resolveGoogleAdsCustomerAuth(businessId, normalizedCustomerId);
  const url = buildGoogleAdsApiUrl(`customers/${normalizedCustomerId}/googleAds:search`);
  const res = await withProviderRateLimit('google_ads', () =>
    googleAdsPost(
      url,
      { query },
      {
        headers: buildGoogleAdsHeaders(accessToken, headerOpts),
        timeout: getGoogleAdsRequestTimeoutMs(),
        validateStatus: () => true,
      }
    )
  );

  if (res.status < 200 || res.status >= 300) {
    throw await createGoogleAdsApiErrorFromResponse(
      res.status,
      res.data,
      'GOOGLE_ADS_POLICY_QUERY_FAILED',
      { label: 'Google Ads ad policy', action: 'googleAds:search' }
    );
  }

  const row = Array.isArray(res.data?.results) ? res.data.results[0] : null;
  const summary = row?.adGroupAd?.policySummary ?? row?.ad_group_ad?.policy_summary ?? {};
  const approvalStatus = summary.approvalStatus ?? summary.approval_status ?? 'UNKNOWN';
  const topics = summary.policyTopicEntries ?? summary.policy_topic_entries ?? [];
  const firstTopic = Array.isArray(topics) && topics.length > 0 ? topics[0] : null;
  const policyTopic =
    typeof firstTopic === 'string'
      ? firstTopic
      : firstTopic?.topic ?? firstTopic?.policyTopic ?? null;

  return {
    approvalStatus,
    policyTopic: policyTopic ? String(policyTopic) : null,
    source: 'google_ads_api',
  };
}

module.exports = {
  fetchCampaignPerformanceMetrics,
  fetchAdPolicyStatus,
};
