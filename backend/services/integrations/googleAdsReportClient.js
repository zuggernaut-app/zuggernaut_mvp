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

module.exports = {
  fetchCampaignPerformanceMetrics,
};
