'use strict';

const axios = require('axios');
const { withProviderRateLimit } = require('../../lib/providerRateLimit');
const { buildDiscoveryResult } = require('./providerDiscoveryResult');

const GOOGLE_ADS_API_VERSION = process.env.GOOGLE_ADS_API_VERSION?.trim() || 'v18';
const DEFAULT_CUSTOMER_CURRENCY = process.env.GOOGLE_ADS_DEFAULT_CURRENCY_CODE?.trim() || 'USD';
const DEFAULT_CUSTOMER_TIME_ZONE = process.env.GOOGLE_ADS_DEFAULT_TIME_ZONE?.trim() || 'America/New_York';

class GoogleAdsAccountError extends Error {
  constructor(message, code = 'GOOGLE_ADS_ACCOUNT_ERROR') {
    super(message);
    this.name = 'GoogleAdsAccountError';
    this.code = code;
  }
}

/**
 * @param {string | number | undefined} customerId
 */
function normalizeCustomerId(customerId) {
  if (customerId == null || customerId === '') return null;
  return String(customerId).replace(/-/g, '').trim();
}

/**
 * @param {string} resourceName — e.g. customers/1234567890
 */
function customerIdFromResourceName(resourceName) {
  if (typeof resourceName !== 'string') return null;
  const match = resourceName.match(/^customers\/(\d+)$/);
  return match ? match[1] : normalizeCustomerId(resourceName.replace(/^customers\//, ''));
}

function getGoogleAdsDeveloperToken() {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  if (!developerToken) {
    throw new GoogleAdsAccountError(
      'GOOGLE_ADS_DEVELOPER_TOKEN is required for Google Ads API calls.',
      'GOOGLE_ADS_DEVELOPER_TOKEN_MISSING'
    );
  }
  return developerToken;
}

function getGoogleAdsLoginCustomerId() {
  const loginCustomerId = normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  if (!loginCustomerId) {
    throw new GoogleAdsAccountError(
      'GOOGLE_ADS_LOGIN_CUSTOMER_ID is required for MCC customer provisioning.',
      'ADS_MCC_CONFIG_MISSING'
    );
  }
  return loginCustomerId;
}

/**
 * @param {string} accessToken
 * @param {{ loginCustomerId?: string | null }} [opts]
 */
function buildGoogleAdsHeaders(accessToken, opts = {}) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': getGoogleAdsDeveloperToken(),
    'Content-Type': 'application/json',
  };

  const loginCustomerId =
    opts.loginCustomerId !== undefined
      ? normalizeCustomerId(opts.loginCustomerId)
      : normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);

  if (loginCustomerId) {
    headers['login-customer-id'] = loginCustomerId;
  }

  return headers;
}

/**
 * @param {object} data
 */
function normalizeCustomerClientResponse(data) {
  const resourceName = typeof data?.resourceName === 'string' ? data.resourceName : null;
  const customerId = customerIdFromResourceName(resourceName);
  if (!customerId) return null;

  return {
    customerId,
    resourceName,
  };
}

/**
 * @param {number} status
 * @param {object} [body]
 */
function mapCreateCustomerError(status, body) {
  const message =
    typeof body?.error?.message === 'string'
      ? body.error.message
      : typeof body?.error?.status === 'string'
        ? body.error.status
        : `Google Ads createCustomerClient failed (${status})`;

  if (status === 403) {
    return new GoogleAdsAccountError(message, 'ADS_MCC_PERMISSION_DENIED');
  }
  if (status === 400 && /billing|payment|budget/i.test(message)) {
    return new GoogleAdsAccountError(message, 'ADS_BILLING_SETUP_REQUIRED');
  }
  if (status === 403 || status === 401) {
    return new GoogleAdsAccountError(message, 'ADS_CUSTOMER_CREATE_DENIED');
  }

  return new GoogleAdsAccountError(message, 'ADS_CUSTOMER_CREATE_FAILED');
}

/**
 * @param {string} accessToken
 */
async function listAccessibleCustomers(accessToken) {
  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return ['1234567890', '9876543210'];
  }

  const headers = buildGoogleAdsHeaders(accessToken);
  delete headers['Content-Type'];

  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`;
  const res = await axios.get(url, {
    headers,
    timeout: 30000,
    validateStatus: () => true,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new GoogleAdsAccountError(
      `Google Ads listAccessibleCustomers failed (${res.status})`,
      'GOOGLE_ADS_LIST_CUSTOMERS_FAILED'
    );
  }

  const resourceNames = Array.isArray(res.data?.resourceNames) ? res.data.resourceNames : [];
  return resourceNames
    .map(customerIdFromResourceName)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Create a customer client under an MCC manager account.
 *
 * @param {string} accessToken
 * @param {string} managerCustomerId
 * @param {{ descriptiveName: string, currencyCode?: string, timeZone?: string }} customerInput
 */
async function createCustomerClient(accessToken, managerCustomerId, customerInput) {
  const descriptiveName = customerInput.descriptiveName?.trim();
  if (!descriptiveName) {
    throw new GoogleAdsAccountError('Customer descriptive name is required.', 'ADS_CUSTOMER_INPUT_INVALID');
  }

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    const customerId = 'mock-provisioned-customer';
    return {
      customerId,
      resourceName: `customers/${customerId}`,
      descriptiveName,
      managerCustomerId: normalizeCustomerId(managerCustomerId),
      provisioningSource: 'mcc_create',
    };
  }

  const managerId = normalizeCustomerId(managerCustomerId);
  if (!managerId) {
    throw new GoogleAdsAccountError('Manager customer id is required.', 'ADS_MCC_CONFIG_MISSING');
  }

  const url = `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${managerId}:createCustomerClient`;
  const res = await axios.post(
    url,
    {
      customerClient: {
        descriptiveName,
        currencyCode: customerInput.currencyCode ?? DEFAULT_CUSTOMER_CURRENCY,
        timeZone: customerInput.timeZone ?? DEFAULT_CUSTOMER_TIME_ZONE,
      },
    },
    {
      headers: buildGoogleAdsHeaders(accessToken, { loginCustomerId: managerId }),
      timeout: 30000,
      validateStatus: () => true,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw mapCreateCustomerError(res.status, res.data);
  }

  const normalized = normalizeCustomerClientResponse(res.data);
  if (!normalized) {
    throw new GoogleAdsAccountError(
      'Google Ads createCustomerClient returned no customer id.',
      'ADS_CUSTOMER_CREATE_INVALID_RESPONSE'
    );
  }

  return {
    ...normalized,
    descriptiveName,
    managerCustomerId: managerId,
    provisioningSource: 'mcc_create',
  };
}

/**
 * Read-only Google Ads customer discovery — never creates or links customers.
 *
 * @param {string} accessToken
 */
async function discoverGoogleAdsProviderIdentifiers(accessToken) {
  try {
    const customerIds = await listAccessibleCustomers(accessToken);

    if (customerIds.length === 0) {
      return buildDiscoveryResult('google_ads', {
        discoveryReason: 'ADS_PROVISIONING_REQUIRED',
      });
    }

    const loginCustomerId = normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
    const providerIdentifiers = {
      customerId: customerIds[0],
      accessibleCustomerIds: customerIds,
      ...(loginCustomerId ? { loginCustomerId, managerCustomerId: loginCustomerId } : {}),
    };

    return buildDiscoveryResult('google_ads', providerIdentifiers);
  } catch (err) {
    return buildDiscoveryResult('google_ads', {
      discoveryError: err.code ?? 'ADS_DISCOVERY_FAILED',
      discoveryReason: 'ADS_PROVISIONING_REQUIRED',
    });
  }
}

module.exports = {
  GoogleAdsAccountError,
  normalizeCustomerId,
  customerIdFromResourceName,
  getGoogleAdsDeveloperToken,
  getGoogleAdsLoginCustomerId,
  buildGoogleAdsHeaders,
  normalizeCustomerClientResponse,
  listAccessibleCustomers: (accessToken) =>
    withProviderRateLimit('google_ads', () => listAccessibleCustomers(accessToken)),
  createCustomerClient: (accessToken, managerCustomerId, customerInput) =>
    withProviderRateLimit('google_ads', () => createCustomerClient(accessToken, managerCustomerId, customerInput)),
  discoverGoogleAdsProviderIdentifiers: (accessToken) =>
    withProviderRateLimit('google_ads', () => discoverGoogleAdsProviderIdentifiers(accessToken)),
};
