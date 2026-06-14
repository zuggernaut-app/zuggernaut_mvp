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
 * @typedef {object} GoogleAdsFieldViolation
 * @property {string} field
 * @property {string} description
 */

/**
 * @typedef {object} GoogleAdsFailureError
 * @property {string | null} field
 * @property {string | null} message
 * @property {string | null} errorCode
 */

/**
 * @typedef {object} GoogleAdsApiErrorDetails
 * @property {number} statusCode
 * @property {string | null} googleStatus
 * @property {string} message
 * @property {string | null} action
 * @property {string[]} redactedCustomerIds
 * @property {GoogleAdsFieldViolation[]} fieldViolations
 * @property {GoogleAdsFailureError[]} googleAdsErrors
 * @property {string | null} requestId
 */

/**
 * @param {unknown} location
 * @returns {string | null}
 */
function formatGoogleAdsFieldPath(location) {
  const elements = Array.isArray(location?.fieldPathElements) ? location.fieldPathElements : [];
  if (elements.length === 0) {
    return null;
  }

  return elements
    .map((el) => {
      const field = typeof el.fieldName === 'string' ? el.fieldName : 'field';
      return el.index != null ? `${field}[${el.index}]` : field;
    })
    .join('.');
}

/**
 * @param {unknown} errorCode
 * @returns {string | null}
 */
function formatGoogleAdsErrorCode(errorCode) {
  if (!errorCode || typeof errorCode !== 'object') {
    return null;
  }

  for (const [key, value] of Object.entries(errorCode)) {
    if (value != null && value !== '') {
      return `${key}:${value}`;
    }
  }

  return null;
}

/**
 * @param {unknown} body
 * @returns {{ fieldViolations: GoogleAdsFieldViolation[], googleAdsErrors: GoogleAdsFailureError[], requestId: string | null }}
 */
function extractGoogleAdsErrorDetails(body) {
  const details = Array.isArray(body?.error?.details) ? body.error.details : [];
  const fieldViolations = [];
  const googleAdsErrors = [];
  let requestId = null;

  for (const row of details) {
    const type = String(row?.['@type'] ?? '');

    if (type.includes('BadRequest') && Array.isArray(row.fieldViolations)) {
      for (const violation of row.fieldViolations) {
        const field = typeof violation?.field === 'string' ? violation.field.trim() : '';
        const description =
          typeof violation?.description === 'string' ? violation.description.trim() : '';
        if (field || description) {
          fieldViolations.push({ field: field || 'unknown', description: description || 'invalid' });
        }
      }
      continue;
    }

    if (!type.includes('GoogleAdsFailure')) {
      continue;
    }

    requestId = typeof row.requestId === 'string' ? row.requestId : requestId;
    const errors = Array.isArray(row.errors) ? row.errors : [];
    for (const entry of errors) {
      googleAdsErrors.push({
        field: formatGoogleAdsFieldPath(entry?.location),
        message: typeof entry?.message === 'string' ? entry.message : null,
        errorCode: formatGoogleAdsErrorCode(entry?.errorCode),
      });
    }
  }

  return { fieldViolations, googleAdsErrors, requestId };
}

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

  const { fieldViolations, googleAdsErrors, requestId } = extractGoogleAdsErrorDetails(body);

  return {
    statusCode,
    googleStatus,
    message: rawMessage ?? `Google Ads API request failed (${statusCode})`,
    action: context.action ?? null,
    redactedCustomerIds: (context.customerIds ?? []).map(redactCustomerId).filter(Boolean),
    fieldViolations,
    googleAdsErrors,
    requestId,
  };
}

/**
 * @param {GoogleAdsApiErrorDetails} parsed
 * @returns {string | null}
 */
function summarizeGoogleAdsApiErrorDetails(parsed) {
  const firstViolation = parsed.fieldViolations[0];
  if (firstViolation) {
    return `${firstViolation.field}: ${firstViolation.description}`;
  }

  const firstAdsError = parsed.googleAdsErrors[0];
  if (firstAdsError) {
    const parts = [firstAdsError.field, firstAdsError.errorCode, firstAdsError.message].filter(Boolean);
    if (parts.length > 0) {
      return parts.join(' — ');
    }
  }

  return null;
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
  const specificDetail = summarizeGoogleAdsApiErrorDetails(parsed);
  const specificSuffix = specificDetail ? ` (${specificDetail})` : '';
  return `${label} failed (${parsed.statusCode})${actionSuffix}: ${detail}${specificSuffix}`;
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

/**
 * Gates Google Ads conversion action creation (write path). Disabled by default.
 * @returns {boolean}
 */
function isConversionActionCreationEnabled() {
  return process.env.GOOGLE_ADS_CONVERSION_ACTION_CREATION_ENABLED === 'true';
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
  extractGoogleAdsErrorDetails,
  summarizeGoogleAdsApiErrorDetails,
  createGoogleAdsApiErrorFromResponse,
  isConversionActionCreationEnabled,
};
