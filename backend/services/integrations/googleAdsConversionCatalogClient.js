'use strict';

const mongoose = require('mongoose');
const { getFreshGoogleAccessToken, getMccGoogleAdsAccessToken } = require('./googleTokenService');
const { withProviderRateLimit } = require('../../lib/providerRateLimit');
const {
  GoogleAdsApiError,
  buildGoogleAdsApiUrl,
  buildGoogleAdsHeaders,
  createGoogleAdsApiErrorFromResponse,
  getGoogleAdsLoginCustomerId,
  getGoogleAdsRequestTimeoutMs,
  googleAdsPost,
  normalizeCustomerId,
} = require('./googleAdsApiConfig');

const {
  extractConversionMeasurementFromTagSnippets,
} = require('../../lib/googleAdsConversionTagSnippets');

const IntegrationConnection = mongoose.model('IntegrationConnection');

const CONVERSION_ACTION_QUERY =
  "SELECT conversion_action.id, conversion_action.name, conversion_action.type, conversion_action.category, conversion_action.status, conversion_action.resource_name, conversion_action.include_in_conversions_metric, conversion_action.phone_call_duration_seconds, conversion_action.tag_snippets FROM conversion_action WHERE conversion_action.status != 'REMOVED'";

/**
 * @param {object} row — Google Ads conversionAction resource or mock row
 */
function normalizeConversionAction(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const externalId =
    row.id != null
      ? String(row.id)
      : row.externalId != null
        ? String(row.externalId)
        : null;

  const resourceName =
    typeof row.resourceName === 'string' && row.resourceName.trim()
      ? row.resourceName.trim()
      : externalId
        ? `customers/unknown/conversionActions/${externalId}`
        : null;

  if (!externalId || !resourceName) return null;

  const tagSnippets = Array.isArray(row.tagSnippets)
    ? row.tagSnippets
    : Array.isArray(row.tag_snippets)
      ? row.tag_snippets
      : null;
  const measurement = extractConversionMeasurementFromTagSnippets(tagSnippets);

  return {
    externalId,
    resourceName,
    name: row.name ?? null,
    category: row.category ?? null,
    status: row.status ?? null,
    type: row.type ?? null,
    includeInConversionsMetric: row.includeInConversionsMetric === true,
    phoneCallDurationSeconds:
      row.phoneCallDurationSeconds ?? row.phone_call_duration_seconds ?? null,
    ...(tagSnippets ? { tagSnippets } : {}),
    ...(measurement
      ? {
          conversionId: measurement.conversionId,
          conversionLabel: measurement.conversionLabel,
        }
      : {}),
  };
}

/**
 * @param {object} resultRow — Google Ads search result row
 */
function normalizeSearchResultRow(resultRow) {
  const ca = resultRow?.conversionAction;
  if (!ca) return null;
  return normalizeConversionAction({
    id: ca.id,
    resourceName: ca.resourceName,
    name: ca.name,
    category: ca.category,
    status: ca.status,
    type: ca.type,
    includeInConversionsMetric: ca.includeInConversionsMetric,
    tagSnippets: ca.tagSnippets,
  });
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {string} [customerIdOverride]
 */
async function fetchGoogleAdsConversionCatalogMock(businessId, customerIdOverride) {
  const conn = await IntegrationConnection.findOne({ businessId, provider: 'google_ads' }).lean();
  const customerId =
    normalizeCustomerId(customerIdOverride) ??
    normalizeCustomerId(conn?.providerIdentifiers?.customerId) ??
    'mock-customer-id';
  const cid = normalizeCustomerId(customerId) ?? 'mockcustomerid';

  const mockRows = conn?.providerIdentifiers?.mockConversionActions;
  if (Array.isArray(mockRows) && mockRows.length > 0) {
    const conversionActions = mockRows
      .map((row) =>
        normalizeConversionAction({
          ...row,
          resourceName:
            row.resourceName ?? `customers/${cid}/conversionActions/${row.id ?? row.externalId}`,
        })
      )
      .filter(Boolean);

    return {
      source: 'google_ads_api_mock',
      recordedAt: new Date().toISOString(),
      customerId,
      conversionActions,
    };
  }

  return {
    source: 'google_ads_api_mock',
    recordedAt: new Date().toISOString(),
    customerId,
    conversionActions: [
      {
        externalId: '1001',
        resourceName: `customers/${cid}/conversionActions/1001`,
        name: 'Phone calls from ads',
        category: 'PHONE_CALL_LEAD',
        status: 'ENABLED',
        type: 'AD_CALL',
        includeInConversionsMetric: true,
        conversionId: 'AW-1234567890',
        conversionLabel: 'call_label_mock',
        tagSnippets: [
          {
            type: 'WEBPAGE',
            pageFormat: 'HTML',
            eventSnippet:
              "gtag('event', 'conversion', {'send_to': 'AW-1234567890/call_label_mock'});",
          },
        ],
      },
      {
        externalId: '1002',
        resourceName: `customers/${cid}/conversionActions/1002`,
        name: 'Website form submit',
        category: 'SUBMIT_LEAD_FORM',
        status: 'ENABLED',
        type: 'WEBPAGE',
        includeInConversionsMetric: true,
        conversionId: 'AW-1234567890',
        conversionLabel: 'form_label_mock',
        tagSnippets: [
          {
            type: 'WEBPAGE',
            pageFormat: 'HTML',
            eventSnippet:
              "gtag('event', 'conversion', {'send_to': 'AW-1234567890/form_label_mock'});",
          },
        ],
      },
    ],
  };
}

/**
 * @param {string} accessToken
 * @param {string} customerId — digits only
 * @param {{ loginCustomerId?: string | null, includeLoginCustomerId?: boolean }} [headerOpts]
 */
async function searchConversionActions(accessToken, customerId, headerOpts = {}) {
  const url = buildGoogleAdsApiUrl(`customers/${customerId}/googleAds:search`);
  const res = await googleAdsPost(
    url,
    { query: CONVERSION_ACTION_QUERY },
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
      'GOOGLE_ADS_CATALOG_SEARCH_FAILED',
      {
        label: 'Google Ads conversion catalog search',
        action: 'googleAds:search',
        customerIds: [customerId],
      }
    );
  }

  const results = Array.isArray(res.data?.results) ? res.data.results : [];
  const conversionActions = results.map(normalizeSearchResultRow).filter(Boolean);

  return conversionActions;
}

/**
 * Read-only Google Ads conversion catalog fetch — never mutates Ads.
 *
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 * @param {string} ctx.customerId — setup-ready normalized customer id
 * @param {import('pino').Logger} [ctx.logger]
 */
async function fetchGoogleAdsConversionCatalog(ctx) {
  const { businessId, customerId: customerIdInput, logger } = ctx;

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return fetchGoogleAdsConversionCatalogMock(businessId, customerIdInput);
  }

  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    throw new GoogleAdsApiError(
      'Google Ads API is not enabled (set GOOGLE_ADS_API_ENABLED=true after configuring credentials).',
      'GOOGLE_ADS_API_NOT_ENABLED'
    );
  }

  const customerId = normalizeCustomerId(customerIdInput);
  if (!customerId) {
    throw new GoogleAdsApiError(
      'Google Ads customerId missing for catalog fetch.',
      'GOOGLE_ADS_CUSTOMER_ID_MISSING'
    );
  }

  const conn = await IntegrationConnection.findOne({ businessId, provider: 'google_ads' })
    .select('providerIdentifiers.mccLink')
    .lean();
  const loginCustomerId = getGoogleAdsLoginCustomerId();
  const mccLink = conn?.providerIdentifiers?.mccLink ?? null;
  const { isMccLinkActiveForSetup } = require('../capabilities/googleAdsMccLinkService');
  const useMccAuth =
    loginCustomerId != null && isMccLinkActiveForSetup(mccLink, customerId, loginCustomerId);

  const accessToken = useMccAuth
    ? await getMccGoogleAdsAccessToken()
    : await getFreshGoogleAccessToken({ businessId, provider: 'google_ads' });
  const headerOpts = useMccAuth ? { loginCustomerId } : {};

  const conversionActions = await withProviderRateLimit('google_ads', () =>
    searchConversionActions(accessToken, customerId, headerOpts)
  );

  if (conversionActions.length === 0) {
    throw new GoogleAdsApiError(
      'No conversion actions accessible for this Google Ads connection.',
      'GOOGLE_ADS_NO_CONVERSION_ACTIONS'
    );
  }

  logger?.info?.(
    { businessId: String(businessId), customerId, count: conversionActions.length, provider: 'google_ads' },
    'google ads conversion catalog fetched from API'
  );

  return {
    source: 'google_ads_api',
    recordedAt: new Date().toISOString(),
    customerId: customerIdInput ?? customerId,
    conversionActions,
  };
}

module.exports = {
  GoogleAdsApiError,
  fetchGoogleAdsConversionCatalog,
  fetchGoogleAdsConversionCatalogMock,
  normalizeConversionAction,
  normalizeCustomerId,
};
