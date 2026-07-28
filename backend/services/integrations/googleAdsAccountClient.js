'use strict';

const { withProviderRateLimit } = require('../../lib/providerRateLimit');
const {
  buildDiscoveryResult,
  buildSelectionRequiredResult,
  defaultSelectionReason,
} = require('./providerDiscoveryResult');
const {
  GoogleAdsAccountError,
  buildGoogleAdsApiUrl,
  buildGoogleAdsHeaders,
  createGoogleAdsApiErrorFromResponse,
  getGoogleAdsLoginCustomerId,
  getGoogleAdsRequestTimeoutMs,
  googleAdsGet,
  googleAdsPost,
  normalizeCustomerId,
  parseGoogleAdsApiError,
} = require('./googleAdsApiConfig');

const DEFAULT_CUSTOMER_CURRENCY = process.env.GOOGLE_ADS_DEFAULT_CURRENCY_CODE?.trim() || 'USD';
const DEFAULT_CUSTOMER_TIME_ZONE = process.env.GOOGLE_ADS_DEFAULT_TIME_ZONE?.trim() || 'America/New_York';

/**
 * @param {string} resourceName — e.g. customers/1234567890
 */
function customerIdFromResourceName(resourceName) {
  if (typeof resourceName !== 'string') return null;
  const match = resourceName.match(/^customers\/(\d+)$/);
  return match ? match[1] : normalizeCustomerId(resourceName.replace(/^customers\//, ''));
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
 * @param {unknown} body
 * @param {string} managerId
 */
function mapCreateCustomerError(status, body, managerId) {
  const parsed = parseGoogleAdsApiError(status, body, {
    action: 'createCustomerClient',
    customerIds: [managerId],
  });
  const message = parsed.message;

  if (status === 403) {
    return new GoogleAdsAccountError(message, 'ADS_MCC_PERMISSION_DENIED', parsed);
  }
  if (status === 400 && /billing|payment|budget/i.test(message)) {
    return new GoogleAdsAccountError(message, 'ADS_BILLING_SETUP_REQUIRED', parsed);
  }
  if (status === 403 || status === 401) {
    return new GoogleAdsAccountError(message, 'ADS_CUSTOMER_CREATE_DENIED', parsed);
  }

  return new GoogleAdsAccountError(message, 'ADS_CUSTOMER_CREATE_FAILED', parsed);
}

/**
 * @param {string} accessToken
 */
async function listAccessibleCustomers(accessToken) {
  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return ['1234567890', '9876543210'];
  }

  // listAccessibleCustomers is account-agnostic — do not send login-customer-id (wrong MCC → 404).
  const headers = buildGoogleAdsHeaders(accessToken, {
    includeLoginCustomerId: false,
    includeContentType: false,
  });

  const url = buildGoogleAdsApiUrl('customers:listAccessibleCustomers');
  const res = await googleAdsGet(url, {
    headers,
    timeout: getGoogleAdsRequestTimeoutMs(),
    validateStatus: () => true,
  });

  if (res.status < 200 || res.status >= 300) {
    throw createGoogleAdsApiErrorFromResponse(
      res.status,
      res.data,
      'GOOGLE_ADS_LIST_CUSTOMERS_FAILED',
      { label: 'Google Ads listAccessibleCustomers', action: 'listAccessibleCustomers' },
      GoogleAdsAccountError
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
 * @param {{ descriptiveName: string, currencyCode?: string, timeZone?: string, testAccount?: boolean }} customerInput
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

  const url = buildGoogleAdsApiUrl(`customers/${managerId}:createCustomerClient`);
  const customerClient = {
    descriptiveName,
    currencyCode: customerInput.currencyCode ?? DEFAULT_CUSTOMER_CURRENCY,
    timeZone: customerInput.timeZone ?? DEFAULT_CUSTOMER_TIME_ZONE,
  };
  if (customerInput.testAccount === true) {
    customerClient.testAccount = true;
  }

  const res = await googleAdsPost(
    url,
    { customerClient },
    {
      headers: buildGoogleAdsHeaders(accessToken, { loginCustomerId: managerId }),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw mapCreateCustomerError(res.status, res.data, managerId);
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

const CUSTOMER_METADATA_QUERY =
  'SELECT customer.id, customer.descriptive_name, customer.manager, customer.status, customer.test_account FROM customer LIMIT 1';

/**
 * @param {unknown} body
 * @returns {string | null}
 */
function parseMetadataAuthorizationError(body) {
  const details = Array.isArray(body?.error?.details) ? body.error.details : [];
  const failure = details.find((row) => String(row['@type'] ?? '').includes('GoogleAdsFailure'));
  const errors = Array.isArray(failure?.errors) ? failure.errors : [];
  const first = errors[0];
  if (!first?.errorCode || typeof first.errorCode !== 'object') {
    return null;
  }
  return (
    first.errorCode.authorizationError ??
    first.errorCode.customerError ??
    first.errorCode.requestError ??
    null
  );
}

/**
 * @param {string} accessToken
 * @param {string} customerId
 */
async function searchGoogleAdsCustomerMetadata(accessToken, customerId) {
  const normalizedId = normalizeCustomerId(customerId);
  if (!normalizedId) {
    return null;
  }

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    const isManager = normalizedId.endsWith('8860');
    const isCancelled = normalizedId.endsWith('1557');
    return {
      customerId: normalizedId,
      descriptiveName: isManager ? 'Zuggernaut AI Campaign Builder' : 'Zuggernaut',
      manager: isManager,
      status: isCancelled ? 'CANCELLED' : 'ENABLED',
      testAccount: false,
    };
  }

  const mccLogin = getGoogleAdsLoginCustomerId();
  const headerVariants = [];
  if (mccLogin && mccLogin !== normalizedId) {
    headerVariants.push({ loginCustomerId: mccLogin });
  }
  headerVariants.push({ loginCustomerId: normalizedId });
  headerVariants.push({ includeLoginCustomerId: false });

  const url = buildGoogleAdsApiUrl(`customers/${normalizedId}/googleAds:search`);
  let lastAuthorizationError = null;

  for (const headerOpts of headerVariants) {
    const res = await googleAdsPost(
      url,
      { query: CUSTOMER_METADATA_QUERY },
      {
        headers: buildGoogleAdsHeaders(accessToken, headerOpts),
        timeout: getGoogleAdsRequestTimeoutMs(),
        validateStatus: () => true,
      }
    );

    if (res.status >= 200 && res.status < 300) {
      const row = Array.isArray(res.data?.results) ? res.data.results[0] : null;
      const customer = row?.customer;
      if (!customer) {
        break;
      }

      return {
        customerId: normalizeCustomerId(customer.id) ?? normalizedId,
        descriptiveName: customer.descriptiveName ?? null,
        manager: customer.manager === true,
        status: customer.status ?? null,
        testAccount: customer.testAccount === true,
      };
    }

    lastAuthorizationError = parseMetadataAuthorizationError(res.data);
    if (lastAuthorizationError === 'CUSTOMER_NOT_ENABLED') {
      break;
    }
  }

  return {
    customerId: normalizedId,
    descriptiveName: null,
    manager: null,
    status: lastAuthorizationError === 'CUSTOMER_NOT_ENABLED' ? 'CANCELLED' : null,
    testAccount: null,
    metadataError: true,
    authorizationError: lastAuthorizationError,
  };
}

/**
 * @param {string} accessToken
 * @param {string[]} customerIds
 */
async function describeAccessibleGoogleAdsCustomers(accessToken, customerIds) {
  const loginCustomerId = getGoogleAdsLoginCustomerId();
  const described = [];

  for (const customerId of customerIds) {
    const metadata = await searchGoogleAdsCustomerMetadata(accessToken, customerId);
    described.push(
      metadata ?? {
        customerId: normalizeCustomerId(customerId),
        descriptiveName: null,
        manager: null,
        status: null,
        testAccount: null,
        metadataError: true,
      }
    );
  }

  return {
    loginCustomerId: loginCustomerId ? normalizeCustomerId(loginCustomerId) : null,
    customers: described,
  };
}

/**
 * When listAccessibleCustomers returns zero rows, discovery records ADS_CUSTOMER_NOT_FOUND.
 * Setup flows escalate to ADS_PROVISIONING_REQUIRED when an MCC login customer is configured.
 *
 * @param {object | null | undefined} providerIdentifiers
 */
function getEffectiveAdsDiscoveryReason(providerIdentifiers) {
  const raw = providerIdentifiers?.discoveryReason ?? null;
  if (raw === 'ADS_CUSTOMER_NOT_FOUND' && getGoogleAdsLoginCustomerId()) {
    return 'ADS_PROVISIONING_REQUIRED';
  }
  return raw;
}

/**
 * Read-only Google Ads customer discovery — never creates or links customers.
 * Does not auto-select customerId; user must choose via resource selection.
 *
 * @param {string} accessToken
 */
async function discoverGoogleAdsProviderIdentifiers(accessToken) {
  try {
    const customerIds = await listAccessibleCustomers(accessToken);

    if (customerIds.length === 0) {
      return buildDiscoveryResult('google_ads', {
        accessibleCustomerIds: [],
        discoveryReason: 'ADS_CUSTOMER_NOT_FOUND',
      });
    }

    const loginCustomerId = getGoogleAdsLoginCustomerId();
    const providerIdentifiers = {
      accessibleCustomerIds: customerIds,
      ...(loginCustomerId ? { loginCustomerId, managerCustomerId: loginCustomerId } : {}),
      discoveryRecordedAt: new Date().toISOString(),
    };

    return buildSelectionRequiredResult(
      'google_ads',
      providerIdentifiers,
      defaultSelectionReason('google_ads')
    );
  } catch (err) {
    const discoveryError = err.code ?? 'ADS_DISCOVERY_FAILED';
    const googleErrorSummary =
      err instanceof GoogleAdsAccountError && err.details
        ? {
            statusCode: err.details.statusCode,
            googleStatus: err.details.googleStatus,
            message: err.details.message,
            action: err.details.action,
            redactedCustomerIds: err.details.redactedCustomerIds,
          }
        : null;

    return buildDiscoveryResult('google_ads', {
      discoveryError,
      discoveryReason: 'ADS_PROVISIONING_REQUIRED',
      ...(googleErrorSummary ? { googleErrorSummary } : {}),
      discoveryMessage: err instanceof Error ? err.message : 'Google Ads discovery failed.',
    });
  }
}

/**
 * @param {string} accessToken
 * @param {string} customerId — account context for the search (manager or client)
 * @param {string} query
 * @param {{ loginCustomerId?: string | null, includeLoginCustomerId?: boolean }} [opts]
 */
async function searchGoogleAds(accessToken, customerId, query, opts = {}) {
  const normalizedId = normalizeCustomerId(customerId);
  if (!normalizedId) {
    throw new GoogleAdsAccountError('customerId is required for search.', 'ADS_SEARCH_INVALID');
  }

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return [];
  }

  const url = buildGoogleAdsApiUrl(`customers/${normalizedId}/googleAds:search`);
  const res = await googleAdsPost(
    url,
    { query },
    {
      headers: buildGoogleAdsHeaders(accessToken, opts),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw createGoogleAdsApiErrorFromResponse(
      res.status,
      res.data,
      'GOOGLE_ADS_SEARCH_FAILED',
      { label: 'Google Ads search', action: 'googleAds:search', customerIds: [normalizedId] },
      GoogleAdsAccountError
    );
  }

  return Array.isArray(res.data?.results) ? res.data.results : [];
}

const LINK_STATUS_PRIORITY = {
  PENDING: 4,
  ACTIVE: 3,
  INACTIVE: 2,
};

/**
 * @param {Array<Record<string, unknown>>} rows
 * @param {'customerClientLink' | 'customerManagerLink'} fieldName
 */
function pickBestLinkFromRows(rows, fieldName) {
  let best = null;
  let bestScore = -1;
  for (const row of rows) {
    const link = row?.[fieldName];
    if (!link || typeof link !== 'object') continue;
    const status = typeof link.status === 'string' ? link.status : null;
    const score = status ? (LINK_STATUS_PRIORITY[status] ?? 1) : 0;
    if (score > bestScore) {
      best = link;
      bestScore = score;
    }
  }
  return best;
}

/**
 * @param {Record<string, unknown> | null} link
 * @param {{ clientCustomer?: string, managerCustomer?: string }} [defaults]
 */
function normalizeLinkRecord(link, defaults = {}) {
  if (!link || typeof link !== 'object') {
    return {
      status: null,
      managerLinkId: null,
      resourceName: null,
      clientCustomer: defaults.clientCustomer ?? null,
      managerCustomer: defaults.managerCustomer ?? null,
    };
  }

  return {
    status: typeof link.status === 'string' ? link.status : null,
    managerLinkId: link.managerLinkId != null ? String(link.managerLinkId) : null,
    resourceName: typeof link.resourceName === 'string' ? link.resourceName : null,
    clientCustomer:
      typeof link.clientCustomer === 'string'
        ? link.clientCustomer
        : (defaults.clientCustomer ?? null),
    managerCustomer:
      typeof link.managerCustomer === 'string'
        ? link.managerCustomer
        : (defaults.managerCustomer ?? null),
  };
}

/**
 * @param {string} accessToken
 * @param {string} managerCustomerId
 * @param {string} clientCustomerId
 */
async function getCustomerClientLinkStatus(accessToken, managerCustomerId, clientCustomerId) {
  const managerId = normalizeCustomerId(managerCustomerId);
  const clientId = normalizeCustomerId(clientCustomerId);
  if (!managerId || !clientId) {
    throw new GoogleAdsAccountError('Manager and client customer ids are required.', 'ADS_LINK_INVALID');
  }

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return {
      status: 'ACTIVE',
      managerLinkId: '1',
      resourceName: `customers/${managerId}/customerClientLinks/1`,
      clientCustomer: `customers/${clientId}`,
      managerCustomer: `customers/${managerId}`,
      source: 'manager',
    };
  }

  const query = [
    'SELECT customer_client_link.resource_name, customer_client_link.manager_link_id,',
    'customer_client_link.status, customer_client_link.client_customer',
    'FROM customer_client_link',
    `WHERE customer_client_link.client_customer = 'customers/${clientId}'`,
  ].join(' ');

  const rows = await searchGoogleAds(accessToken, managerId, query, { loginCustomerId: managerId });
  const link = pickBestLinkFromRows(rows, 'customerClientLink');
  return normalizeLinkRecord(link, {
    clientCustomer: `customers/${clientId}`,
    managerCustomer: `customers/${managerId}`,
  });
}

/**
 * Pending invitations are often visible on the client account via CustomerManagerLink.
 *
 * @param {string} accessToken
 * @param {string} clientCustomerId
 * @param {string} managerCustomerId
 */
async function getCustomerManagerLinkStatus(accessToken, clientCustomerId, managerCustomerId) {
  const clientId = normalizeCustomerId(clientCustomerId);
  const managerId = normalizeCustomerId(managerCustomerId);
  if (!clientId || !managerId) {
    throw new GoogleAdsAccountError('Client and manager customer ids are required.', 'ADS_LINK_INVALID');
  }

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return {
      status: null,
      managerLinkId: null,
      resourceName: null,
      clientCustomer: `customers/${clientId}`,
      managerCustomer: `customers/${managerId}`,
      source: 'client',
    };
  }

  const query = [
    'SELECT customer_manager_link.resource_name, customer_manager_link.manager_link_id,',
    'customer_manager_link.status, customer_manager_link.manager_customer',
    'FROM customer_manager_link',
    `WHERE customer_manager_link.manager_customer = 'customers/${managerId}'`,
  ].join(' ');

  const rows = await searchGoogleAds(accessToken, clientId, query, { loginCustomerId: clientId });
  const link = pickBestLinkFromRows(rows, 'customerManagerLink');
  return normalizeLinkRecord(link, {
    clientCustomer: `customers/${clientId}`,
    managerCustomer: `customers/${managerId}`,
  });
}

/**
 * Combine manager-side and client-side link views, preferring PENDING then ACTIVE.
 *
 * @param {string} managerAccessToken — MCC admin token for manager-side CustomerClientLink queries
 * @param {string} managerCustomerId
 * @param {string} clientCustomerId
 * @param {string} [customerAccessToken] — tenant token for client-side CustomerManagerLink queries
 */
async function resolveMccLinkStatus(
  managerAccessToken,
  managerCustomerId,
  clientCustomerId,
  customerAccessToken = managerAccessToken
) {
  const [managerView, clientView] = await Promise.all([
    getCustomerClientLinkStatus(managerAccessToken, managerCustomerId, clientCustomerId),
    getCustomerManagerLinkStatus(customerAccessToken, clientCustomerId, managerCustomerId),
  ]);

  const managerLink = { ...managerView, source: 'manager' };
  const clientLink = { ...clientView, source: 'client' };
  const pending =
    [clientLink, managerLink].find((link) => link.status === 'PENDING' && link.managerLinkId) ?? null;
  const active =
    [managerLink, clientLink].find((link) => link.status === 'ACTIVE') ?? null;
  const linkStatus = pending ?? active ?? (managerLink.status ? managerLink : clientLink);

  const activeLink = active ?? null;

  return {
    managerView: managerLink,
    clientView: clientLink,
    pending,
    active: activeLink,
    linkStatus,
    linkReady: isMccLinkActive({ managerView: managerLink, clientView: clientLink }),
  };
}

/**
 * @param {{ managerView?: { status?: string | null }, clientView?: { status?: string | null } }} resolved
 */
function isMccLinkActive(resolved) {
  return (
    resolved?.managerView?.status === 'ACTIVE' || resolved?.clientView?.status === 'ACTIVE'
  );
}

/**
 * Invite a client account to link under a manager (PENDING).
 *
 * @param {string} accessToken
 * @param {string} managerCustomerId
 * @param {string} clientCustomerId
 */
async function createCustomerClientLinkInvitation(accessToken, managerCustomerId, clientCustomerId) {
  const managerId = normalizeCustomerId(managerCustomerId);
  const clientId = normalizeCustomerId(clientCustomerId);
  if (!managerId || !clientId) {
    throw new GoogleAdsAccountError('Manager and client customer ids are required.', 'ADS_LINK_INVALID');
  }

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return {
      resourceName: `customers/${managerId}/customerClientLinks/999`,
      status: 'PENDING',
      managerLinkId: '999',
    };
  }

  const url = buildGoogleAdsApiUrl(`customers/${managerId}/customerClientLinks:mutate`);
  const res = await googleAdsPost(
    url,
    {
      operation: {
        create: {
          clientCustomer: `customers/${clientId}`,
          status: 'PENDING',
        },
      },
    },
    {
      headers: buildGoogleAdsHeaders(accessToken, { loginCustomerId: managerId }),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw createGoogleAdsApiErrorFromResponse(
      res.status,
      res.data,
      'ADS_CLIENT_LINK_CREATE_FAILED',
      { label: 'CustomerClientLink create', action: 'customerClientLinks:mutate', customerIds: [managerId, clientId] },
      GoogleAdsAccountError
    );
  }

  const resourceName = res.data?.result?.resourceName ?? null;
  if (!resourceName) {
    throw new GoogleAdsAccountError(
      'CustomerClientLink mutate returned no resource name.',
      'ADS_CLIENT_LINK_INVALID_RESPONSE'
    );
  }

  const query = `SELECT customer_client_link.manager_link_id, customer_client_link.status FROM customer_client_link WHERE customer_client_link.resource_name = '${resourceName}'`;
  const rows = await searchGoogleAds(accessToken, managerId, query, { loginCustomerId: managerId });
  const link = rows[0]?.customerClientLink ?? {};

  return {
    resourceName,
    status: link.status ?? 'PENDING',
    managerLinkId: link.managerLinkId != null ? String(link.managerLinkId) : null,
  };
}

/**
 * Accept a manager invitation from the client account side (ACTIVE).
 *
 * @param {string} accessToken
 * @param {string} clientCustomerId
 * @param {string} managerCustomerId
 * @param {string | number} managerLinkId
 */
async function acceptCustomerManagerLink(accessToken, clientCustomerId, managerCustomerId, managerLinkId) {
  const clientId = normalizeCustomerId(clientCustomerId);
  const managerId = normalizeCustomerId(managerCustomerId);
  const linkId = managerLinkId != null ? String(managerLinkId).trim() : '';
  if (!clientId || !managerId || !linkId) {
    throw new GoogleAdsAccountError(
      'clientCustomerId, managerCustomerId, and managerLinkId are required.',
      'ADS_LINK_INVALID'
    );
  }

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    return {
      resourceName: `customers/${clientId}/customerManagerLinks/${managerId}~${linkId}`,
      status: 'ACTIVE',
    };
  }

  const resourceName = `customers/${clientId}/customerManagerLinks/${managerId}~${linkId}`;
  const url = buildGoogleAdsApiUrl(`customers/${clientId}/customerManagerLinks:mutate`);
  const res = await googleAdsPost(
    url,
    {
      operations: [
        {
          update: {
            resourceName,
            status: 'ACTIVE',
          },
          updateMask: 'status',
        },
      ],
    },
    {
      headers: buildGoogleAdsHeaders(accessToken, { loginCustomerId: clientId }),
      timeout: getGoogleAdsRequestTimeoutMs(),
      validateStatus: () => true,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw createGoogleAdsApiErrorFromResponse(
      res.status,
      res.data,
      'ADS_MANAGER_LINK_ACCEPT_FAILED',
      { label: 'CustomerManagerLink accept', action: 'customerManagerLinks:mutate', customerIds: [clientId, managerId] },
      GoogleAdsAccountError
    );
  }

  return {
    resourceName: res.data?.results?.[0]?.resourceName ?? resourceName,
    status: 'ACTIVE',
  };
}

module.exports = {
  GoogleAdsAccountError,
  getEffectiveAdsDiscoveryReason,
  normalizeCustomerId,
  customerIdFromResourceName,
  getGoogleAdsLoginCustomerId,
  buildGoogleAdsHeaders,
  normalizeCustomerClientResponse,
  searchGoogleAds,
  pickBestLinkFromRows,
  getCustomerClientLinkStatus,
  getCustomerManagerLinkStatus,
  resolveMccLinkStatus,
  isMccLinkActive,
  createCustomerClientLinkInvitation,
  acceptCustomerManagerLink,
  listAccessibleCustomers: (accessToken) =>
    withProviderRateLimit('google_ads', () => listAccessibleCustomers(accessToken)),
  createCustomerClient: (accessToken, managerCustomerId, customerInput) =>
    withProviderRateLimit('google_ads', () => createCustomerClient(accessToken, managerCustomerId, customerInput)),
  discoverGoogleAdsProviderIdentifiers: (accessToken) =>
    withProviderRateLimit('google_ads', () => discoverGoogleAdsProviderIdentifiers(accessToken)),
  searchGoogleAdsCustomerMetadata: (accessToken, customerId) =>
    withProviderRateLimit('google_ads', () => searchGoogleAdsCustomerMetadata(accessToken, customerId)),
  describeAccessibleGoogleAdsCustomers: (accessToken, customerIds) =>
    withProviderRateLimit('google_ads', () =>
      describeAccessibleGoogleAdsCustomers(accessToken, customerIds)
    ),
};
