'use strict';

/**
 * Provider resource selection contract (Phase 5A product flow).
 * OAuth grants access; user explicitly selects setup-ready Google Ads customer or GTM hierarchy.
 */

const SELECTION_REASON_CODES = Object.freeze([
  'ADS_CUSTOMER_SELECTION_REQUIRED',
  'GTM_RESOURCE_SELECTION_REQUIRED',
]);

const GOOGLE_ADS_ACCOUNT_KIND = Object.freeze({
  MANAGER: 'manager',
  CLIENT: 'client',
  UNKNOWN: 'unknown',
});

const GOOGLE_ADS_ACCOUNT_STATUS = Object.freeze({
  ENABLED: 'enabled',
  CANCELLED: 'cancelled',
  CLOSED: 'closed',
  SUSPENDED: 'suspended',
  UNKNOWN: 'unknown',
});

const GOOGLE_ADS_NON_SELECTABLE_STATUSES = Object.freeze([
  GOOGLE_ADS_ACCOUNT_STATUS.CANCELLED,
  GOOGLE_ADS_ACCOUNT_STATUS.CLOSED,
  GOOGLE_ADS_ACCOUNT_STATUS.SUSPENDED,
]);

const SELECTION_SOURCE = Object.freeze({
  PRODUCT_SETUP: 'product_setup',
});

module.exports = {
  SELECTION_REASON_CODES,
  GOOGLE_ADS_ACCOUNT_KIND,
  GOOGLE_ADS_ACCOUNT_STATUS,
  GOOGLE_ADS_NON_SELECTABLE_STATUSES,
  SELECTION_SOURCE,
};
