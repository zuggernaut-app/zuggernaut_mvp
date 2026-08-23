'use strict';

const { ADS_INTENT_CODES } = require('../constants/adsCampaignIntent');
const { ADS_READINESS_CODES } = require('../constants/businessContextAdsReadiness');

const GENERIC_SETUP_FAILURE =
  'Setup could not be completed. Review the details below and try again, or contact support if the issue persists.';

/** @type {Record<string, string>} */
const SETUP_USER_ERROR_MESSAGES = Object.freeze({
  // Provisioning — GTM
  GTM_ACCOUNT_NOT_FOUND:
    'No Google Tag Manager account was found. Create one at tagmanager.google.com, then approve provisioning again.',
  GTM_PROVISIONING_FAILED:
    'Google Tag Manager provisioning failed. Review your GTM connection and try again.',
  GTM_PROVISIONING_INCOMPLETE:
    'Google Tag Manager provisioning finished without the required container details.',
  GTM_PROVISIONING_APPROVAL_REQUIRED:
    'Google Tag Manager provisioning requires your explicit approval before setup can continue.',
  GTM_PROVISIONING_REQUEST_NOT_FOUND: 'The GTM provisioning request could not be found.',
  GTM_PROVISIONING_INVALID_PROVIDER: 'The provisioning request is not for Google Tag Manager.',
  GTM_PROVISIONING_INVALID_REQUEST: 'The GTM provisioning request is missing required resources.',
  GTM_PROVISIONING_BUSINESS_MISMATCH: 'The GTM provisioning request does not match this business.',

  // Provisioning — Ads
  ADS_PROVISIONING_FAILED:
    'Google Ads customer provisioning failed. Review your Google Ads connection and MCC configuration, then try again.',
  ADS_PROVISIONING_INCOMPLETE:
    'Google Ads provisioning finished without the required customer identifiers.',
  ADS_PROVISIONING_APPROVAL_REQUIRED:
    'Google Ads customer provisioning requires your explicit approval before setup can continue.',
  ADS_PROVISIONING_REQUEST_NOT_FOUND: 'The Google Ads provisioning request could not be found.',
  ADS_PROVISIONING_INVALID_PROVIDER: 'The provisioning request is not for Google Ads.',
  ADS_PROVISIONING_INVALID_REQUEST:
    'The Google Ads provisioning request is missing required resources.',
  ADS_PROVISIONING_BUSINESS_MISMATCH:
    'The Google Ads provisioning request does not match this business.',
  ADS_MCC_PERMISSION_DENIED:
    'Google Ads provisioning was denied. Confirm MCC permissions and billing eligibility, then try again.',
  ADS_MCC_CREATE_DENIED:
    'Google Ads could not create a customer under your manager account. Confirm MCC permissions and billing eligibility.',

  // Setup discovery / connection
  ADS_CUSTOMER_SELECTION_REQUIRED:
    'Select which Google Ads customer account Zuggernaut should use, or approve creating a new one.',
  ADS_CUSTOMER_NOT_FOUND:
    'No usable Google Ads customer account was found for this connection.',
  ADS_DISCOVERY_UNEXPECTED:
    'Google Ads account discovery returned an unexpected result. Reconnect Google Ads and try again.',
  ADS_DISCOVERY_FAILED:
    'Google Ads customer discovery failed. Reconnect Google Ads and try again.',
  GOOGLE_ADS_SETUP_NOT_READY:
    'Google Ads is not ready for setup. Review your connection and selected customer account.',
  GOOGLE_ADS_IDENTIFIERS_MISSING:
    'Google Ads connection is missing required account identifiers.',
  ADS_MISSING_CUSTOMER_ID: 'Google Ads connection is missing a customer account ID.',
  ADS_MISSING_CONNECTION: 'Connect Google Ads before continuing setup.',
  ADS_API_NOT_ENABLED: 'Google Ads API access is not enabled for this environment.',
  ADS_SELECTION_NOT_ALLOWED: 'The selected Google Ads account cannot be used for setup.',
  ADS_SELECTION_REQUIRED:
    'Select which Google Ads customer account Zuggernaut should use, or choose to create a new account under your manager.',
  GTM_SELECTION_REQUIRED:
    'Multiple Google Tag Manager accounts are available. Select one before provisioning.',
  ADS_MCC_LINK_REQUIRED: 'This Google Ads account must be linked under your manager account before setup can continue.',

  // GTM setup
  GTM_SETUP_FAILED: 'Google Tag Manager setup failed. Review your GTM connection and container access.',
  GTM_SNIPPET_PENDING:
    'Install the Google Tag Manager snippet on your website before setup can continue.',
  GTM_MISSING_IDENTIFIERS: 'Google Tag Manager connection is missing required container identifiers.',
  GTM_MISSING_ADS_CONVERSIONS:
    'Google Tag Manager setup needs conversion actions from Google Ads before tags can be created.',
  GTM_API_NOT_ENABLED: 'Google Tag Manager API access is not enabled for this environment.',
  GTM_RATE_LIMITED:
    'Google Tag Manager is temporarily rate limiting requests. Wait a few minutes and try again.',
  GTM_CREATE_FAILED: 'Google Tag Manager could not create the requested resource.',

  // Structural verification / tracking
  SETUP_NEEDS_TRACKING_FIX:
    'Tracking setup needs attention before setup can continue. Review the verification details below.',
  SETUP_NEEDS_MANUAL_REVIEW:
    'Setup paused until Google integrations are connected or reviewed.',

  // Conversion actions
  CONVERSION_ACTION_CREATE_FAILED:
    'Google Ads conversion action setup failed. Review account permissions and try again.',
  CONVERSION_STRATEGY_MISSING_GOALS:
    'Confirm your primary business goal (calls, forms, or both) before conversion actions can be created.',
  ConversionActionManagementError:
    'Conversion action management failed. Review Google Ads permissions and try again.',
  GOOGLE_ADS_CONVERSION_CREATION_DISABLED:
    'Google Ads conversion action creation is disabled and required slots are still unfilled.',
  GOOGLE_ADS_MUTATE_FAILED:
    'Google Ads could not apply the requested changes. Review account permissions and setup inputs, then try again.',
  GOOGLE_ADS_CATALOG_SEARCH_FAILED:
    'Google Ads conversion catalog could not be read. Try again in a few minutes.',
  GOOGLE_ADS_NO_CONVERSION_ACTIONS:
    'No Google Ads conversion actions were found for this account.',
  GOOGLE_ADS_RATE_LIMITED:
    'Google Ads is temporarily rate limiting requests. Wait a few minutes and try again.',
  GOOGLE_ADS_LIST_CUSTOMERS_FAILED:
    'Google Ads could not list accessible customer accounts. Reconnect Google Ads and try again.',
  GOOGLE_ADS_API_NOT_ENABLED: 'Google Ads API access is not enabled for this environment.',
  ADS_MISSING_CONVERSIONS:
    'At least one Google Ads conversion action is required before campaign creation can continue.',

  // Post-setup campaign management
  ADS_CAMPAIGN_NOT_FOUND:
    'No Google Ads campaign was found for this business. Complete setup before managing the campaign.',
  ADS_CAMPAIGN_BUDGET_NOT_FOUND:
    'The campaign budget could not be resolved. Review Google Ads account access and try again.',
  ADS_CAMPAIGN_BUDGET_TOO_LOW: 'Daily budget must be greater than zero.',
  ADS_CAMPAIGN_BUDGET_MAX_EXCEEDED:
    'Daily budget exceeds the maximum allowed for this account. Lower the amount and try again.',
  GOOGLE_ADS_ENABLE_FAILED:
    'Google Ads could not enable the campaign. Review account permissions and try again.',
  GOOGLE_ADS_PAUSE_FAILED:
    'Google Ads could not pause the campaign. Review account permissions and try again.',
  GOOGLE_ADS_BUDGET_UPDATE_FAILED:
    'Google Ads could not update the campaign budget. Review account permissions and try again.',

  // GBP
  GBP_NO_ACCOUNTS: 'No Google Business Profile accounts were found for this Google account.',
  GBP_NO_LOCATIONS: 'No Google Business Profile locations were found for this account.',
  GBP_DISCOVERY_FAILED: 'Google Business Profile discovery failed. Try again later.',

  // Ads readiness
  [ADS_READINESS_CODES.MISSING_WEBSITE_URL]:
    'Website URL is required before Google Ads setup can start.',
  [ADS_READINESS_CODES.INVALID_WEBSITE_URL]:
    'Website URL must be a valid http or https URL before Google Ads setup can start.',
  [ADS_READINESS_CODES.MISSING_BUSINESS_NAME]:
    'Business name is required before Google Ads setup can start.',
  [ADS_READINESS_CODES.MISSING_SERVICES]:
    'Add at least one service or an industry before Google Ads setup can start.',
  [ADS_READINESS_CODES.MISSING_SERVICE_AREAS]:
    'Add at least one service area before Google Ads setup can start.',
  [ADS_READINESS_CODES.PLACEHOLDER_SERVICE_AREA]:
    'Confirm a real city or region for your service area before Google Ads setup can start.',
  [ADS_READINESS_CODES.MISSING_GOALS]:
    'Choose a primary business goal (calls, forms, or both) before Google Ads setup can start.',
  [ADS_READINESS_CODES.UNSUPPORTED_GOAL]:
    'Primary business goal must be calls, forms, or both.',

  // Campaign intent validation
  [ADS_INTENT_CODES.KEYWORD_INVALID_CHARS]:
    'Keyword text contains invalid characters or symbols.',
  [ADS_INTENT_CODES.KEYWORD_SANITIZED_EMPTY]:
    'Keyword text could not be converted into valid Google Ads keywords.',
  [ADS_INTENT_CODES.KEYWORD_TOO_MANY_WORDS]:
    'Keyword text has too many words for Google Ads.',
  [ADS_INTENT_CODES.UNRESOLVED_GEO]:
    'Could not resolve a location target from your service area.',
  [ADS_INTENT_CODES.INVALID_GEO_TARGET]:
    'The selected service area is not a valid Google Ads location target.',
  [ADS_INTENT_CODES.MISSING_GEO_TARGET_LABELS]:
    'A service area is required before Google Ads campaign creation can start.',
  [ADS_INTENT_CODES.MISSING_CONVERSION_ACTIONS]:
    'At least one Google Ads conversion action is required before campaign creation can continue.',
});

/**
 * @param {string | null | undefined} message
 * @returns {boolean}
 */
function isLikelyRawProviderError(message) {
  const text = String(message ?? '').trim();
  if (!text) return false;

  return (
    /Google Ads API/i.test(text) ||
    /Tag Manager API/i.test(text) ||
    /operations\[\d+\]/i.test(text) ||
    /\bPERMISSION_DENIED\b/.test(text) ||
    /\bcustomers\/\d+/i.test(text) ||
    /\bstatus:\s*\d{3}\b/i.test(text) ||
    /\bUNAUTHENTICATED\b/.test(text) ||
    /\bINVALID_ARGUMENT\b/.test(text) ||
    /fieldError:/i.test(text) ||
    /responseBody/i.test(text) ||
    text.length > 240
  );
}

/**
 * @param {object} [input]
 * @param {string | null | undefined} [input.errorCode]
 * @param {string | null | undefined} [input.fallbackMessage]
 * @returns {string}
 */
function resolveSetupUserErrorMessage(input = {}) {
  const errorCode = typeof input.errorCode === 'string' ? input.errorCode.trim() : '';
  const fallbackMessage =
    typeof input.fallbackMessage === 'string' ? input.fallbackMessage.trim() : '';

  if (errorCode && SETUP_USER_ERROR_MESSAGES[errorCode]) {
    return SETUP_USER_ERROR_MESSAGES[errorCode];
  }

  if (fallbackMessage && !isLikelyRawProviderError(fallbackMessage)) {
    return fallbackMessage;
  }

  if (errorCode || fallbackMessage) {
    return GENERIC_SETUP_FAILURE;
  }

  return GENERIC_SETUP_FAILURE;
}

/**
 * @param {object | null | undefined} details
 * @returns {string | null}
 */
function errorCodeFromStepDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return null;
  }

  if (typeof details.code === 'string' && details.code.trim()) {
    return details.code.trim();
  }
  if (typeof details.errorCode === 'string' && details.errorCode.trim()) {
    return details.errorCode.trim();
  }

  const issues = Array.isArray(details.issues) ? details.issues : [];
  const firstIssue = issues.length > 0 && issues[0] && typeof issues[0] === 'object' ? issues[0] : null;
  if (typeof firstIssue?.code === 'string' && firstIssue.code.trim()) {
    return firstIssue.code.trim();
  }

  return null;
}

/**
 * @param {string | null | undefined} summary
 * @param {string | null | undefined} errorCode
 * @returns {string | null}
 */
function sanitizeSetupErrorSummary(summary, errorCode) {
  if (typeof summary !== 'string' || !summary.trim()) {
    return null;
  }

  return resolveSetupUserErrorMessage({
    errorCode,
    fallbackMessage: summary,
  });
}

/**
 * @param {object | null | undefined} step
 * @returns {string | null}
 */
function sanitizeStepErrorSummary(step) {
  if (!step || typeof step.lastErrorSummary !== 'string' || !step.lastErrorSummary.trim()) {
    return null;
  }

  return sanitizeSetupErrorSummary(step.lastErrorSummary, errorCodeFromStepDetails(step.details));
}

module.exports = {
  GENERIC_SETUP_FAILURE,
  SETUP_USER_ERROR_MESSAGES,
  isLikelyRawProviderError,
  resolveSetupUserErrorMessage,
  errorCodeFromStepDetails,
  sanitizeSetupErrorSummary,
  sanitizeStepErrorSummary,
};
