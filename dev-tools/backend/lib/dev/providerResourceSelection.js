'use strict';

const {
  GOOGLE_ADS_ACCOUNT_KIND,
  GOOGLE_ADS_ACCOUNT_STATUS,
  GOOGLE_ADS_NON_SELECTABLE_STATUSES,
  SELECTION_SOURCE,
} = require('../../constants/providerResourceSelection');
const { normalizeCustomerId } = require('../../../../backend/services/integrations/googleAdsApiConfig');

/**
 * @param {string | number | null | undefined} customerId
 * @returns {string | null}
 */
function formatGoogleAdsCustomerId(customerId) {
  const digits = normalizeCustomerId(customerId);
  if (!digits || digits.length !== 10) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * @param {string | null | undefined} rawStatus — Google Ads customer.status enum
 */
function normalizeGoogleAdsAccountStatus(rawStatus) {
  const status = typeof rawStatus === 'string' ? rawStatus.trim().toUpperCase() : '';
  if (status === 'ENABLED') return GOOGLE_ADS_ACCOUNT_STATUS.ENABLED;
  if (status === 'CANCELLED') return GOOGLE_ADS_ACCOUNT_STATUS.CANCELLED;
  if (status === 'CLOSED') return GOOGLE_ADS_ACCOUNT_STATUS.CLOSED;
  if (status === 'SUSPENDED') return GOOGLE_ADS_ACCOUNT_STATUS.SUSPENDED;
  return GOOGLE_ADS_ACCOUNT_STATUS.UNKNOWN;
}

/**
 * @param {{ manager?: boolean | null, status?: string | null }} metadata
 */
function inferGoogleAdsAccountKind(metadata) {
  if (metadata?.manager === true) return GOOGLE_ADS_ACCOUNT_KIND.MANAGER;
  if (metadata?.manager === false) return GOOGLE_ADS_ACCOUNT_KIND.CLIENT;
  return GOOGLE_ADS_ACCOUNT_KIND.UNKNOWN;
}

/**
 * @param {{ kind: string, status: string, selectable?: boolean }} option
 */
function isGoogleAdsAccountSelectable(option) {
  if (!option || typeof option !== 'object') return false;
  if (option.selectable === false) return false;
  if (option.kind === GOOGLE_ADS_ACCOUNT_KIND.MANAGER) return false;
  return !GOOGLE_ADS_NON_SELECTABLE_STATUSES.includes(option.status);
}

/**
 * @param {string} customerId
 * @param {{ descriptiveName?: string | null, manager?: boolean | null, status?: string | null, testAccount?: boolean | null, metadataError?: boolean, authorizationError?: string | null }} metadata
 * @param {{ loginCustomerId?: string | null }} [ctx]
 */
function buildGoogleAdsCustomerOption(customerId, metadata = {}, ctx = {}) {
  const normalizedId = normalizeCustomerId(customerId);

  if (metadata.metadataError) {
    const authErr = metadata.authorizationError;
    let nonSelectableReason =
      'Could not verify this account via the Google Ads API. Reconnect OAuth or pick another account.';
    if (authErr === 'DEVELOPER_TOKEN_NOT_APPROVED') {
      nonSelectableReason =
        'Not a Google Ads test account. Test developer tokens can only create resources in test accounts.';
    } else if (authErr === 'USER_PERMISSION_DENIED') {
      nonSelectableReason =
        'OAuth user cannot access this account with the configured MCC login-customer-id.';
    } else if (authErr === 'CUSTOMER_NOT_ENABLED') {
      nonSelectableReason = 'Account is not enabled (cancelled or closed).';
    }

    const status =
      authErr === 'CUSTOMER_NOT_ENABLED'
        ? GOOGLE_ADS_ACCOUNT_STATUS.CANCELLED
        : GOOGLE_ADS_ACCOUNT_STATUS.UNKNOWN;

    return {
      customerId: normalizedId,
      formattedCustomerId: formatGoogleAdsCustomerId(normalizedId),
      descriptiveName: metadata.descriptiveName ?? null,
      kind: GOOGLE_ADS_ACCOUNT_KIND.UNKNOWN,
      status,
      testAccount: false,
      selectable: false,
      nonSelectableReason,
      loginCustomerId: ctx.loginCustomerId ? normalizeCustomerId(ctx.loginCustomerId) : null,
    };
  }

  const kind = inferGoogleAdsAccountKind(metadata);
  const status = normalizeGoogleAdsAccountStatus(metadata.status);
  const selectable = isGoogleAdsAccountSelectable({ kind, status });

  let nonSelectableReason = null;
  if (kind === GOOGLE_ADS_ACCOUNT_KIND.MANAGER) {
    nonSelectableReason = 'Manager accounts cannot be used for campaign creation diagnostics.';
  } else if (status === GOOGLE_ADS_ACCOUNT_STATUS.CANCELLED) {
    nonSelectableReason = 'Cancelled Google Ads accounts cannot be used.';
  } else if (status === GOOGLE_ADS_ACCOUNT_STATUS.CLOSED) {
    nonSelectableReason = 'Closed Google Ads accounts cannot be used.';
  } else if (status === GOOGLE_ADS_ACCOUNT_STATUS.SUSPENDED) {
    nonSelectableReason = 'Suspended Google Ads accounts cannot be used.';
  }

  return {
    customerId: normalizedId,
    formattedCustomerId: formatGoogleAdsCustomerId(normalizedId),
    descriptiveName: metadata.descriptiveName ?? null,
    kind,
    status,
    testAccount: metadata.testAccount === true,
    selectable,
    nonSelectableReason,
    loginCustomerId: ctx.loginCustomerId ? normalizeCustomerId(ctx.loginCustomerId) : null,
  };
}

/**
 * @param {unknown} body
 */
function parseGoogleAdsSelectionBody(body) {
  const businessId = typeof body?.businessId === 'string' ? body.businessId.trim() : '';
  const customerId = typeof body?.customerId === 'string' ? normalizeCustomerId(body.customerId) : '';
  return { businessId, customerId };
}

/**
 * @param {unknown} body
 */
function parseGtmSelectionBody(body) {
  const businessId = typeof body?.businessId === 'string' ? body.businessId.trim() : '';
  const accountId = typeof body?.accountId === 'string' ? body.accountId.trim() : '';
  const containerId = typeof body?.containerId === 'string' ? body.containerId.trim() : '';
  const workspaceId = typeof body?.workspaceId === 'string' ? body.workspaceId.trim() : '';
  return { businessId, accountId, containerId, workspaceId };
}

/**
 * @param {string} source
 */
function selectionTimestampFields(source = SELECTION_SOURCE.DEV_INTEGRATIONS) {
  return {
    selectedAt: new Date().toISOString(),
    selectionSource: source,
  };
}

/**
 * Prefer explicit dev env override, then test accounts, then other client accounts.
 *
 * @param {Array<{ customerId: string, selectable: boolean, testAccount?: boolean, kind?: string }>} options
 * @returns {string | null}
 */
function pickPreferredGoogleAdsCustomerOption(options) {
  if (!Array.isArray(options) || options.length === 0) {
    return null;
  }

  const preferredId = normalizeCustomerId(process.env.GOOGLE_ADS_PREFERRED_TEST_CUSTOMER_ID);
  if (preferredId) {
    const preferred = options.find((row) => row.customerId === preferredId && row.selectable);
    if (preferred) {
      return preferred.customerId;
    }
  }

  const testAccount = options.find((row) => row.selectable && row.testAccount === true);
  if (testAccount) {
    return testAccount.customerId;
  }

  const client = options.find(
    (row) => row.selectable && row.kind === GOOGLE_ADS_ACCOUNT_KIND.CLIENT,
  );
  if (client) {
    return client.customerId;
  }

  return options.find((row) => row.selectable)?.customerId ?? null;
}

module.exports = {
  formatGoogleAdsCustomerId,
  normalizeGoogleAdsAccountStatus,
  inferGoogleAdsAccountKind,
  isGoogleAdsAccountSelectable,
  buildGoogleAdsCustomerOption,
  pickPreferredGoogleAdsCustomerOption,
  parseGoogleAdsSelectionBody,
  parseGtmSelectionBody,
  selectionTimestampFields,
};
