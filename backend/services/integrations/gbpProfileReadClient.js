'use strict';

const axios = require('axios');
const mongoose = require('mongoose');
const { withProviderRateLimit } = require('../../lib/providerRateLimit');
const { buildDiscoveryResult } = require('./providerDiscoveryResult');
const { getFreshGoogleAccessToken } = require('./googleTokenService');

const BusinessContext = mongoose.model('BusinessContext');
const IntegrationConnection = mongoose.model('IntegrationConnection');

const GBP_ACCOUNTS_URL = 'https://mybusinessaccountmanagement.googleapis.com/v1/accounts';
const GBP_BUSINESS_INFO_BASE = 'https://mybusinessbusinessinformation.googleapis.com/v1';

class GbpApiError extends Error {
  constructor(message, code = 'GBP_API_ERROR') {
    super(message);
    this.name = 'GbpApiError';
    this.code = code;
  }
}

/**
 * @param {object} bc
 */
function phoneFromBusinessContext(bc) {
  const cm = bc?.contactMethods;
  if (!cm || typeof cm !== 'object') return null;
  if (typeof cm.phone === 'string' && cm.phone.trim()) return cm.phone.trim();
  if (Array.isArray(cm.phones) && cm.phones[0]) return String(cm.phones[0]).trim();
  return null;
}

/**
 * @param {object | undefined} serviceArea
 * @returns {string[]}
 */
function extractServiceAreasFromGbp(serviceArea) {
  if (!serviceArea || typeof serviceArea !== 'object') return [];
  if (Array.isArray(serviceArea.places?.placeInfos)) {
    return serviceArea.places.placeInfos
      .map((p) => p?.placeName ?? p?.name)
      .filter(Boolean)
      .map(String);
  }
  if (serviceArea.regionCode) return [String(serviceArea.regionCode)];
  return [];
}

/**
 * @param {object} location — Google Business Information API location resource
 */
function normalizeGbpLocation(location) {
  if (!location || typeof location !== 'object') {
    return {
      businessName: null,
      websiteUrl: null,
      primaryCategory: null,
      phoneNumber: null,
      serviceAreas: [],
      openingHoursPresent: false,
    };
  }

  const primaryCategory =
    location.categories?.primaryCategory?.displayName ??
    location.categories?.primaryCategory?.name ??
    null;

  const phoneNumber =
    location.phoneNumbers?.primaryPhone ??
    location.phoneNumbers?.[0]?.number ??
    null;

  return {
    businessName: location.title ?? null,
    websiteUrl: location.websiteUri ?? null,
    primaryCategory,
    phoneNumber,
    serviceAreas: extractServiceAreasFromGbp(location.serviceArea),
    openingHoursPresent: Boolean(location.regularHours?.periods?.length),
  };
}

/**
 * Deterministic mock read model for tests and local dev (explicit source label).
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function fetchGbpProfileReadModelMock(businessId) {
  const bc = await BusinessContext.findOne({ businessId }).lean();
  if (!bc) {
    throw new GbpApiError('BusinessContext missing for GBP mock read', 'GBP_CONTEXT_MISSING');
  }

  const conn = await IntegrationConnection.findOne({ businessId, provider: 'gbp' }).lean();
  const mockProfile =
    conn?.providerIdentifiers?.mockProfile && typeof conn.providerIdentifiers.mockProfile === 'object'
      ? conn.providerIdentifiers.mockProfile
      : {};

  return {
    source: 'gbp_api_mock',
    recordedAt: new Date().toISOString(),
    locationName: conn?.providerIdentifiers?.locationName ?? 'accounts/mock/locations/mock',
    profile: {
      businessName: mockProfile.businessName ?? bc.businessName ?? null,
      websiteUrl: mockProfile.websiteUrl ?? bc.websiteUrl ?? null,
      primaryCategory: mockProfile.primaryCategory ?? bc.industry ?? null,
      phoneNumber: mockProfile.phoneNumber ?? phoneFromBusinessContext(bc),
      serviceAreas: mockProfile.serviceAreas ?? bc.serviceAreas ?? [],
      openingHoursPresent:
        typeof mockProfile.openingHoursPresent === 'boolean' ? mockProfile.openingHoursPresent : false,
    },
  };
}

/**
 * @param {string} accessToken
 * @param {string} locationName — e.g. accounts/123/locations/456
 */
async function fetchGbpLocationByName(accessToken, locationName) {
  const url = `${GBP_BUSINESS_INFO_BASE}/${locationName}`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: {
      readMask:
        'title,websiteUri,categories,phoneNumbers,serviceArea,regularHours,storefrontAddress',
    },
    timeout: 20000,
    validateStatus: () => true,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new GbpApiError(`GBP location fetch failed (${res.status})`, 'GBP_LOCATION_FETCH_FAILED');
  }

  return res.data;
}

/**
 * @param {string} accessToken
 */
async function listGbpAccounts(accessToken) {
  const res = await axios.get(GBP_ACCOUNTS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 20000,
    validateStatus: () => true,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new GbpApiError(`GBP accounts list failed (${res.status})`, 'GBP_ACCOUNTS_FETCH_FAILED');
  }

  return Array.isArray(res.data?.accounts) ? res.data.accounts : [];
}

/**
 * @param {string} accessToken
 * @param {string} accountName — e.g. accounts/123
 */
async function listGbpLocations(accessToken, accountName) {
  const url = `${GBP_BUSINESS_INFO_BASE}/${accountName}/locations`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    params: { readMask: 'name,title' },
    timeout: 20000,
    validateStatus: () => true,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new GbpApiError(`GBP locations list failed (${res.status})`, 'GBP_LOCATIONS_FETCH_FAILED');
  }

  return Array.isArray(res.data?.locations) ? res.data.locations : [];
}

/**
 * Resolve location name from connection identifiers or first accessible location.
 * @param {string} accessToken
 * @param {object | null | undefined} providerIdentifiers
 */
async function resolveLocationName(accessToken, providerIdentifiers) {
  const stored = providerIdentifiers?.locationName;
  if (typeof stored === 'string' && stored.trim()) {
    return stored.trim();
  }

  const accounts = await listGbpAccounts(accessToken);
  if (accounts.length === 0) {
    throw new GbpApiError('No GBP accounts accessible for this connection', 'GBP_NO_ACCOUNTS');
  }

  const accountName = accounts[0].name;
  if (!accountName) {
    throw new GbpApiError('GBP account missing name field', 'GBP_ACCOUNT_INVALID');
  }

  const locations = await listGbpLocations(accessToken, accountName);
  if (locations.length === 0) {
    throw new GbpApiError('No GBP locations accessible for this account', 'GBP_NO_LOCATIONS');
  }

  const locName = locations[0].name;
  if (!locName) {
    throw new GbpApiError('GBP location missing name field', 'GBP_LOCATION_INVALID');
  }

  return locName;
}

/**
 * Read-only GBP account/location discovery — never creates or mutates GBP resources.
 *
 * @param {string} accessToken
 */
async function discoverGbpProviderIdentifiers(accessToken) {
  if (process.env.GBP_API_MOCK === 'true') {
    return buildDiscoveryResult('gbp', {
      accountName: 'accounts/mock',
      locationName: 'accounts/mock/locations/mock',
    });
  }

  try {
    const accounts = await listGbpAccounts(accessToken);
    if (accounts.length === 0) {
      return buildDiscoveryResult('gbp', { discoveryReason: 'GBP_NO_ACCOUNTS' }, { reason: 'GBP_NO_ACCOUNTS' });
    }

    const sortedAccounts = accounts
      .filter((a) => a.name)
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));

    for (const account of sortedAccounts) {
      const locations = await listGbpLocations(accessToken, account.name);
      if (locations.length === 0) continue;

      const sortedLocations = locations
        .filter((l) => l.name)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));

      const location = sortedLocations[0];
      if (!location?.name) continue;

      return buildDiscoveryResult('gbp', {
        accountName: account.name,
        locationName: location.name,
      });
    }

    return buildDiscoveryResult('gbp', { discoveryReason: 'GBP_NO_LOCATIONS' }, { reason: 'GBP_NO_LOCATIONS' });
  } catch (err) {
    const code = err.code === 'GBP_NO_ACCOUNTS' || err.code === 'GBP_NO_LOCATIONS' ? err.code : 'GBP_DISCOVERY_FAILED';
    return buildDiscoveryResult(
      'gbp',
      { discoveryError: code, discoveryReason: code },
      { reason: code === 'GBP_DISCOVERY_FAILED' ? null : code }
    );
  }
}

/**
 * Read-only GBP profile fetch — never mutates GBP.
 *
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 * @param {import('pino').Logger} [ctx.logger]
 */
async function fetchGbpProfileReadModel(ctx) {
  const { businessId, logger } = ctx;

  if (process.env.GBP_API_MOCK === 'true') {
    return fetchGbpProfileReadModelMock(businessId);
  }

  if (process.env.GBP_API_ENABLED !== 'true') {
    throw new GbpApiError(
      'GBP API is not enabled (set GBP_API_ENABLED=true after configuring Google credentials).',
      'GBP_API_NOT_ENABLED'
    );
  }

  const conn = await IntegrationConnection.findOne({ businessId, provider: 'gbp' }).lean();
  const discoveryReason = conn?.providerIdentifiers?.discoveryReason;
  if (discoveryReason === 'GBP_NO_ACCOUNTS' || discoveryReason === 'GBP_NO_LOCATIONS') {
    throw new GbpApiError(
      discoveryReason === 'GBP_NO_ACCOUNTS'
        ? 'No Google Business Profile accounts found for this Google account.'
        : 'No Google Business Profile locations found for this account.',
      discoveryReason
    );
  }

  const accessToken = await getFreshGoogleAccessToken({ businessId, provider: 'gbp' });
  const locationName = await resolveLocationName(accessToken, conn?.providerIdentifiers);
  const location = await fetchGbpLocationByName(accessToken, locationName);

  logger?.info?.(
    { businessId: String(businessId), locationName, provider: 'gbp' },
    'gbp profile read fetched from API'
  );

  return {
    source: 'gbp_api',
    recordedAt: new Date().toISOString(),
    locationName,
    profile: normalizeGbpLocation(location),
  };
}

module.exports = {
  GbpApiError,
  listGbpAccounts: (accessToken) => withProviderRateLimit('gbp', () => listGbpAccounts(accessToken)),
  listGbpLocations: (accessToken, accountName) =>
    withProviderRateLimit('gbp', () => listGbpLocations(accessToken, accountName)),
  discoverGbpProviderIdentifiers: (accessToken) =>
    withProviderRateLimit('gbp', () => discoverGbpProviderIdentifiers(accessToken)),
  fetchGbpProfileReadModel,
  fetchGbpProfileReadModelMock,
  normalizeGbpLocation,
  phoneFromBusinessContext,
  extractServiceAreasFromGbp,
};
