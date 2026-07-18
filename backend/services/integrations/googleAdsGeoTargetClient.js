'use strict';

const axios = require('axios');
const { withProviderRateLimit } = require('../../lib/providerRateLimit');
const { getFreshGoogleAccessToken } = require('./googleTokenService');
const { ADS_INTENT_CODES } = require('../../constants/adsCampaignIntent');
const {
  GoogleAdsApiError,
  buildGoogleAdsApiUrl,
  buildGoogleAdsHeaders,
  createGoogleAdsApiErrorFromResponse,
  getGoogleAdsRequestTimeoutMs,
  normalizeCustomerId,
} = require('./googleAdsApiConfig');

const DEFAULT_GEO_SUGGEST_LOCALE = 'en';
const DEFAULT_GEO_SUGGEST_COUNTRY = 'US';
const GEO_SUGGEST_FALLBACK_LABEL = 'United States';
const GEO_SUGGEST_ALTERNATIVE_LABELS_FOR_US = ['United States of America', 'USA'];

class GeoTargetResolutionError extends Error {
  /**
   * @param {string} message
   * @param {string} [code]
   */
  constructor(message, code = ADS_INTENT_CODES.UNRESOLVED_GEO) {
    super(message);
    this.name = 'GeoTargetResolutionError';
    this.code = code;
  }
}

/**
 * @param {string | undefined | null} value
 */
function normalizeLabelForMatch(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase();
}

/**
 * @param {string | undefined | null} value
 */
function normalizeGeoComparable(value) {
  return normalizeLabelForMatch(value).replace(/[,\s]+/g, ' ').trim();
}

/**
 * @param {string} label
 */
function mockGeoTargetSlug(label) {
  const slug = normalizeGeoComparable(label).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || 'unknown';
}

/**
 * @param {string} label
 */
function buildMockGeoTarget(label) {
  const trimmed = String(label ?? '').trim();
  return {
    resourceName: `geoTargetConstants/mock-geo-${mockGeoTargetSlug(trimmed)}`,
    label: trimmed,
    canonicalName: `${trimmed}, United States`,
    targetType: 'City',
    countryCode: DEFAULT_GEO_SUGGEST_COUNTRY,
  };
}

/**
 * @param {Array<{ geoTargetConstant?: object, searchTerm?: string }>} suggestions
 * @param {string} label
 * @param {string} [targetCountryCode]
 * @returns {object | null}
 */
function pickBestGeoSuggestion(suggestions, label, targetCountryCode) {
  const normalizedLabel = normalizeGeoComparable(label);
  if (!Array.isArray(suggestions) || suggestions.length < 1) {
    return null;
  }

  const enabled = suggestions.filter(
    (row) => !row.geoTargetConstant?.status || row.geoTargetConstant.status === 'ENABLED'
  );
  const pool = enabled.length > 0 ? enabled : suggestions;
  if (pool.length === 1) {
    return pool[0].geoTargetConstant ?? null;
  }

  const exactMatches = pool.filter((row) => {
    const gtc = row.geoTargetConstant ?? {};
    const name = normalizeGeoComparable(gtc.name);
    const canonical = normalizeGeoComparable(gtc.canonicalName);
    return (
      name === normalizedLabel ||
      canonical === normalizedLabel ||
      canonical.startsWith(`${normalizedLabel},`) ||
      canonical.startsWith(`${normalizedLabel} `)
    );
  });

  const candidates = exactMatches.length > 0 ? exactMatches : pool;

  const cityMatches = candidates.filter((row) => row.geoTargetConstant?.targetType === 'City');
  const finalPool = cityMatches.length > 0 ? cityMatches : candidates;

  if (finalPool.length === 1) {
    return finalPool[0].geoTargetConstant ?? null;
  }

  if (targetCountryCode) {
    const inCountry = finalPool.filter((row) => row.geoTargetConstant?.countryCode === targetCountryCode);
    if (inCountry.length === 1) {
      return inCountry[0].geoTargetConstant ?? null;
    }
    if (inCountry.length > 1) {
      return inCountry[0].geoTargetConstant ?? null;
    }
  }

  return finalPool[0]?.geoTargetConstant ?? null;
}

/**
 * @param {object} geoTargetConstant
 * @param {string} label
 */
function toResolvedGeoTarget(geoTargetConstant, label) {
  const resourceName = String(geoTargetConstant?.resourceName ?? '').trim();
  if (!resourceName) {
    throw new GeoTargetResolutionError(
      `Could not resolve geographic target for "${label}".`,
      ADS_INTENT_CODES.UNRESOLVED_GEO
    );
  }

  return {
    resourceName,
    label: String(label ?? '').trim() || String(geoTargetConstant?.name ?? '').trim(),
    canonicalName: String(geoTargetConstant?.canonicalName ?? '').trim() || null,
    targetType: geoTargetConstant?.targetType ?? null,
    countryCode: geoTargetConstant?.countryCode ?? null,
  };
}

/**
 * @param {string} accessToken
 * @param {string} customerId
 * @param {string} suggestLabel
 */
async function postGeoTargetSuggest(accessToken, customerId, suggestLabel) {
  const url = buildGoogleAdsApiUrl('geoTargetConstants:suggest');
  return axios.post(
    url,
    {
      locale: DEFAULT_GEO_SUGGEST_LOCALE,
      countryCode: DEFAULT_GEO_SUGGEST_COUNTRY,
      locationNames: {
        names: [suggestLabel],
      },
    },
    {
      headers: buildGoogleAdsHeaders(accessToken),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );
}

/**
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 * @param {string} ctx.customerId
 * @param {string} ctx.label
 */
async function resolvePrimaryGeoTargetConstant(ctx) {
  const label = String(ctx.label ?? '').trim();
  if (!label) {
    throw new GeoTargetResolutionError(
      'Primary service area label is required for geographic targeting.',
      ADS_INTENT_CODES.MISSING_GEO_TARGET_LABELS
    );
  }

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return buildMockGeoTarget(label);
  }

  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    throw new GeoTargetResolutionError(
      'Google Ads API is not enabled (set GOOGLE_ADS_API_ENABLED=true after configuring credentials).',
      'GOOGLE_ADS_API_NOT_ENABLED'
    );
  }

  const customerId = normalizeCustomerId(ctx.customerId);
  if (!customerId) {
    throw new GeoTargetResolutionError('Google Ads customer id is required for geo resolution.');
  }

  const accessToken = await getFreshGoogleAccessToken({ businessId: ctx.businessId, provider: 'google_ads' });
  let res = await postGeoTargetSuggest(accessToken, customerId, label);

  if (res.status === 404) {
    const labelNorm = label.toLowerCase();
    const candidates =
      labelNorm === GEO_SUGGEST_FALLBACK_LABEL.toLowerCase() ? GEO_SUGGEST_ALTERNATIVE_LABELS_FOR_US : [GEO_SUGGEST_FALLBACK_LABEL];

    for (const candidateLabel of candidates) {
      const candidateRes = await postGeoTargetSuggest(accessToken, customerId, candidateLabel);

      if (candidateRes.status >= 200 && candidateRes.status < 300) {
        const candidateSuggestions = Array.isArray(candidateRes.data?.geoTargetConstantSuggestions)
          ? candidateRes.data.geoTargetConstantSuggestions
          : [];
        const candidatePicked = pickBestGeoSuggestion(
          candidateSuggestions,
          candidateLabel,
          DEFAULT_GEO_SUGGEST_COUNTRY
        );

        if (candidatePicked) {
          return toResolvedGeoTarget(candidatePicked, label);
        }
      }

      // If candidate fails, continue to next candidate. Preserve last response for error details.
      res = candidateRes;
    }
  }

  if (res.status < 200 || res.status >= 300) {
    throw createGoogleAdsApiErrorFromResponse(
      res.status,
      res.data,
      'GOOGLE_ADS_GEO_SUGGEST_FAILED',
      {
        label: 'Google Ads geo target suggest',
        action: 'geoTargetConstants:suggest',
        customerIds: [customerId],
      }
    );
  }

  const suggestions = Array.isArray(res.data?.geoTargetConstantSuggestions)
    ? res.data.geoTargetConstantSuggestions
    : [];
  const picked = pickBestGeoSuggestion(suggestions, label, DEFAULT_GEO_SUGGEST_COUNTRY);
  if (!picked) {
    throw new GeoTargetResolutionError(
      `Could not resolve a unique geographic target for "${label}". Provide a more specific service area.`,
      ADS_INTENT_CODES.UNRESOLVED_GEO
    );
  }

  return toResolvedGeoTarget(picked, label);
}

module.exports = {
  GeoTargetResolutionError,
  pickBestGeoSuggestion,
  resolvePrimaryGeoTargetConstant: (ctx) =>
    withProviderRateLimit('google_ads', () => resolvePrimaryGeoTargetConstant(ctx)),
};
