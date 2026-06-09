'use strict';

/**
 * Provider resource selection contract (Phase 5A / dev integrations).
 * OAuth grants access; user explicitly selects setup-ready Google Ads customer or GTM hierarchy.
 */

const SELECTION_REASON_CODES = Object.freeze([
  'ADS_CUSTOMER_SELECTION_REQUIRED',
  'GTM_RESOURCE_SELECTION_REQUIRED',
]);

/** Google Ads account role inferred from customer.manager. */
const GOOGLE_ADS_ACCOUNT_KIND = Object.freeze({
  MANAGER: 'manager',
  CLIENT: 'client',
  UNKNOWN: 'unknown',
});

/** Normalized Google Ads customer lifecycle states for selection UX. */
const GOOGLE_ADS_ACCOUNT_STATUS = Object.freeze({
  ENABLED: 'enabled',
  CANCELLED: 'cancelled',
  CLOSED: 'closed',
  SUSPENDED: 'suspended',
  UNKNOWN: 'unknown',
});

/** Statuses that block campaign/resource mutations. */
const GOOGLE_ADS_NON_SELECTABLE_STATUSES = Object.freeze([
  GOOGLE_ADS_ACCOUNT_STATUS.CANCELLED,
  GOOGLE_ADS_ACCOUNT_STATUS.CLOSED,
  GOOGLE_ADS_ACCOUNT_STATUS.SUSPENDED,
]);

/** IntegrationConnection.providerIdentifiers keys written on explicit user selection. */
const GOOGLE_ADS_SELECTION_IDENTIFIER_KEYS = Object.freeze([
  'customerId',
  'loginCustomerId',
  'managerCustomerId',
  'selectedCustomerDescriptiveName',
  'selectedCustomerKind',
  'selectedCustomerStatus',
  'selectedAt',
  'selectionSource',
]);

const GTM_SELECTION_IDENTIFIER_KEYS = Object.freeze([
  'accountId',
  'accountName',
  'containerId',
  'containerName',
  'publicContainerId',
  'workspaceId',
  'workspaceName',
  'selectedAt',
  'selectionSource',
]);

const SELECTION_SOURCE = Object.freeze({
  DEV_INTEGRATIONS: 'dev_integrations',
});

module.exports = {
  SELECTION_REASON_CODES,
  GOOGLE_ADS_ACCOUNT_KIND,
  GOOGLE_ADS_ACCOUNT_STATUS,
  GOOGLE_ADS_NON_SELECTABLE_STATUSES,
  GOOGLE_ADS_SELECTION_IDENTIFIER_KEYS,
  GTM_SELECTION_IDENTIFIER_KEYS,
  SELECTION_SOURCE,
};
