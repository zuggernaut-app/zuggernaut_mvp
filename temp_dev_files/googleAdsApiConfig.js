'use strict';

const DEFAULT_GOOGLE_ADS_API_VERSION = 'v24';
const GOOGLE_ADS_API_ORIGIN = 'https://googleads.googleapis.com';
const DEFAULT_GOOGLE_ADS_REQUEST_TIMEOUT_MS = 30_000;

class GoogleAdsApiError extends Error {
  /**
   * @param {string} message
   * @param {string} [code]
   * @param {import('./googleAdsApiConfig').GoogleAdsApiErrorDetails | undefined} [details]
   */
  constructor(message, code = 'GOOGLE_ADS_API_ERROR', details = undefined) {
    super(message);
    this.name = 'GoogleAdsApiError';
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }
}

class GoogleAdsAccountError extends GoogleAdsApiError {
  /**
   * @param {string} message
   * @param {string} [code]
   * @param {import('./googleAdsApiConfig').GoogleAdsApiErrorDetails | undefined} [details]
   */
  constructor(message, code = 'GOOGLE_ADS_ACCOUNT_ERROR', details = undefined) {
    super(message, code, details);
    this.name = 'GoogleAdsAccountError';
  }
}

/**
 * @returns {string}
 */
function getGoogleAdsApiVersion() {
  const fromEnv = process.env.GOOGLE_ADS_API_VERSION?.trim();
  return fromEnv || DEFAULT_GOOGLE_ADS_API_VERSION;
}

/**
 * @returns {number}
 */
function getGoogleAdsRequestTimeoutMs() {
  const raw = process.env.GOOGLE_ADS_REQUEST_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_GOOGLE_ADS_REQUEST_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_GOOGLE_ADS_REQUEST_TIMEOUT_MS;
  }

  return parsed;
}

/**
 * @param {string} resourcePath — e.g. customers:listAccessibleCustomers
 * @returns {string}
 */
function buildGoogleAdsApiUrl(resourcePath) {
  const path = resourcePath.startsWith('/') ? resourcePath.slice(1) : resourcePath;
  return `${GOOGLE_ADS_API_ORIGIN}/${getGoogleAdsApiVersion()}/${path}`;
}

/**
 * @param {string | number | undefined | null} customerId
 * @returns {string | null}
 */
function normalizeCustomerId(customerId) {
  if (customerId == null || customerId === '') {
    return null;
  }
  return String(customerId).replace(/-/g, '').trim();
}

/**
 * @param {string | number | undefined | null} customerId
 * @returns {string | null}
 */
function redactCustomerId(customerId) {
  const normalized = normalizeCustomerId(customerId);
  if (!normalized) {
    return null;
  }
  if (normalized.length <= 4) {
    return '****';
  }
  return `…${normalized.slice(-4)}`;
}

/**
 * @returns {string}
 */
function getGoogleAdsDeveloperToken() {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();
  if (!developerToken) {
    throw new GoogleAdsApiError(
      'GOOGLE_ADS_DEVELOPER_TOKEN is required for Google Ads API calls.',
      'GOOGLE_ADS_DEVELOPER_TOKEN_MISSING'
    );
  }
  return developerToken;
}

/**
 * @param {{ required?: boolean }} [opts]
 * @returns {string | null}
 */
function getGoogleAdsLoginCustomerId(opts = {}) {
  const loginCustomerId = normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  if (!loginCustomerId && opts.required) {
    throw new GoogleAdsAccountError(
      'GOOGLE_ADS_LOGIN_CUSTOMER_ID is required for MCC customer provisioning.',
      'ADS_MCC_CONFIG_MISSING'
    );
  }
  return loginCustomerId;
}

/**
 * @param {string} accessToken
 * @param {{
 *   loginCustomerId?: string | number | null,
 *   includeLoginCustomerId?: boolean,
 *   includeContentType?: boolean,
 * }} [opts]
 * @returns {Record<string, string>}
 */
function buildGoogleAdsHeaders(accessToken, opts = {}) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': getGoogleAdsDeveloperToken(),
  };

  if (opts.includeContentType !== false) {
    headers['Content-Type'] = 'application/json';
  }

  if (opts.includeLoginCustomerId === false) {
    return headers;
  }

  const loginCustomerId =
    opts.loginCustomerId !== undefined
      ? normalizeCustomerId(opts.loginCustomerId)
      : getGoogleAdsLoginCustomerId();

  if (loginCustomerId) {
    headers['login-customer-id'] = loginCustomerId;
  }

  return headers;
}

/**
 * @typedef {object} GoogleAdsApiErrorDetails
 * @property {number} statusCode
 * @property {string | null} googleStatus
 * @property {string} message
 * @property {string | null} action
 * @property {string[]} redactedCustomerIds
 */

/**
 * Safely extract structured details from a Google Ads REST error body.
 *
 * @param {number} statusCode
 * @param {unknown} body
 * @param {{ action?: string, customerIds?: Array<string | number | null | undefined> }} [context]
 * @returns {GoogleAdsApiErrorDetails}
 */
function parseGoogleAdsApiError(statusCode, body, context = {}) {
  const googleStatus =
    typeof body === 'object' &&
    body !== null &&
    typeof body.error === 'object' &&
    body.error !== null &&
    typeof body.error.status === 'string'
      ? body.error.status
      : null;

  const rawMessage =
    typeof body === 'object' &&
    body !== null &&
    typeof body.error === 'object' &&
    body.error !== null &&
    typeof body.error.message === 'string'
      ? body.error.message
      : googleStatus;

  return {
    statusCode,
    googleStatus,
    message: rawMessage ?? `Google Ads API request failed (${statusCode})`,
    action: context.action ?? null,
    redactedCustomerIds: (context.customerIds ?? []).map(redactCustomerId).filter(Boolean),
  };
}

/**
 * @param {GoogleAdsApiErrorDetails} parsed
 * @param {string} label
 * @returns {string}
 */
function formatGoogleAdsApiErrorMessage(parsed, label) {
  const detail =
    parsed.googleStatus && parsed.message !== parsed.googleStatus
      ? `${parsed.googleStatus}: ${parsed.message}`
      : parsed.message;
  const actionSuffix = parsed.action ? ` [${parsed.action}]` : '';
  return `${label} failed (${parsed.statusCode})${actionSuffix}: ${detail}`;
}

/**
 * @param {number} status
 * @param {unknown} body
 * @param {string} code
 * @param {{ action?: string, customerIds?: Array<string | number | null | undefined>, label?: string }} [context]
 * @param {typeof GoogleAdsApiError} [ErrorClass]
 * @returns {GoogleAdsApiError}
 */
function createGoogleAdsApiErrorFromResponse(status, body, code, context = {}, ErrorClass = GoogleAdsApiError) {
  const parsed = parseGoogleAdsApiError(status, body, context);
  const message = formatGoogleAdsApiErrorMessage(parsed, context.label ?? 'Google Ads API request');
  return new ErrorClass(message, code, parsed);
}

module.exports = {
  DEFAULT_GOOGLE_ADS_API_VERSION,
  GOOGLE_ADS_API_ORIGIN,
  DEFAULT_GOOGLE_ADS_REQUEST_TIMEOUT_MS,
  GoogleAdsApiError,
  GoogleAdsAccountError,
  getGoogleAdsApiVersion,
  getGoogleAdsRequestTimeoutMs,
  buildGoogleAdsApiUrl,
  normalizeCustomerId,
  redactCustomerId,
  getGoogleAdsDeveloperToken,
  getGoogleAdsLoginCustomerId,
  buildGoogleAdsHeaders,
  parseGoogleAdsApiError,
  formatGoogleAdsApiErrorMessage,
  createGoogleAdsApiErrorFromResponse,
};
