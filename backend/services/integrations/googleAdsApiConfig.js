'use strict';

const axios = require('axios');
const { createLogger } = require('../../lib/observability/logger');

const googleAdsApiConfigLogger = createLogger({ name: 'googleAdsApiConfig' });

const DEFAULT_GOOGLE_ADS_API_VERSION = 'v24';
const GOOGLE_ADS_API_ORIGIN = 'https://googleads.googleapis.com';
const DEFAULT_GOOGLE_ADS_REQUEST_TIMEOUT_MS = 30_000;

const GOOGLE_ADS_RATE_LIMIT_MAX_ATTEMPTS_DEFAULT = 5;
const GOOGLE_ADS_RATE_LIMIT_BASE_MS_DEFAULT = 2000;
const GOOGLE_ADS_RATE_LIMIT_MAX_WAIT_MS_DEFAULT = 60_000;

function getGoogleAdsRateLimitMaxAttempts() {
  return Number(
    process.env.GOOGLE_ADS_RATE_LIMIT_MAX_ATTEMPTS || GOOGLE_ADS_RATE_LIMIT_MAX_ATTEMPTS_DEFAULT
  );
}

function getGoogleAdsRateLimitBaseMs() {
  return Number(process.env.GOOGLE_ADS_RATE_LIMIT_BASE_MS || GOOGLE_ADS_RATE_LIMIT_BASE_MS_DEFAULT);
}

function getGoogleAdsRateLimitMaxWaitMs() {
  return Number(
    process.env.GOOGLE_ADS_RATE_LIMIT_MAX_WAIT_MS || GOOGLE_ADS_RATE_LIMIT_MAX_WAIT_MS_DEFAULT
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string | number | string[] | undefined} retryAfter
 * @returns {number | null}
 */
function parseRetryAfterMs(retryAfter) {
  const raw = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;
  if (raw == null || raw === '') {
    return null;
  }

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  const dateMs = Date.parse(String(raw));
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }

  return null;
}

/**
 * @param {number} attempt — zero-based retry index after the first 429
 * @param {string | number | string[] | undefined} retryAfterHeader
 * @returns {number}
 */
function googleAdsRateLimitWaitMs(attempt, retryAfterHeader) {
  const fromHeader = parseRetryAfterMs(retryAfterHeader);
  if (fromHeader != null) {
    return Math.min(fromHeader, getGoogleAdsRateLimitMaxWaitMs());
  }

  const jitterMs = Math.floor(Math.random() * 250);
  return Math.min(getGoogleAdsRateLimitBaseMs() * 2 ** attempt + jitterMs, getGoogleAdsRateLimitMaxWaitMs());
}

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
 * Platform-level MCC admin OAuth refresh token for manager-side Google Ads mutations
 * (e.g. CustomerClientLink invite). Never tenant-scoped; load from server secrets only.
 *
 * @param {{ required?: boolean }} [opts]
 * @returns {string | null}
 */
function getMccGoogleAdsRefreshToken(opts = {}) {
  const refreshToken = process.env.GOOGLE_ADS_MCC_REFRESH_TOKEN?.trim();
  if (!refreshToken && opts.required !== false) {
    throw new GoogleAdsAccountError(
      'GOOGLE_ADS_MCC_REFRESH_TOKEN is required for MCC link invite operations.',
      'ADS_MCC_REFRESH_TOKEN_MISSING'
    );
  }
  return refreshToken || null;
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
 * Retries only confirmed HTTP 429 responses with no successful result.
 * All other statuses return immediately for existing client error handling.
 *
 * @param {() => Promise<import('axios').AxiosResponse>} requestFn
 * @param {{ operation?: string, action?: string, customerIds?: Array<string | number | null | undefined> }} [logContext]
 * @returns {Promise<import('axios').AxiosResponse>}
 */
async function axiosWithGoogleAdsRateLimitRetry(requestFn, logContext = {}) {
  const maxAttempts = getGoogleAdsRateLimitMaxAttempts();

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const res = await requestFn();
    if (res.status !== 429) {
      return res;
    }

    if (attempt >= maxAttempts - 1) {
      throw createGoogleAdsApiErrorFromResponse(
        res.status,
        res.data,
        'GOOGLE_ADS_RATE_LIMITED',
        {
          label: 'Google Ads API request',
          action: logContext.action ?? logContext.operation ?? 'googleAds:request',
          customerIds: logContext.customerIds,
        }
      );
    }

    const waitMs = googleAdsRateLimitWaitMs(attempt, res.headers?.['retry-after']);
    const { recordGoogleAdsRateLimitHit } = require('../../lib/observability/otel');
    recordGoogleAdsRateLimitHit();
    googleAdsApiConfigLogger.warn(
      {
        operation: logContext.operation ?? 'google_ads_request',
        action: logContext.action ?? null,
        attempt: attempt + 1,
        maxAttempts,
        waitMs,
        status: 429,
      },
      'Google Ads API rate limited; retrying'
    );
    await sleep(waitMs);
  }

  throw createGoogleAdsApiErrorFromResponse(
    429,
    null,
    'GOOGLE_ADS_RATE_LIMITED',
    {
      label: 'Google Ads API request',
      action: logContext.action ?? logContext.operation ?? 'googleAds:request',
      customerIds: logContext.customerIds,
    }
  );
}

/**
 * @param {string} url
 * @param {unknown} body
 * @param {import('axios').AxiosRequestConfig} config
 * @param {{ operation?: string, action?: string, customerIds?: Array<string | number | null | undefined> }} [logContext]
 */
async function googleAdsPost(url, body, config, logContext = {}) {
  return axiosWithGoogleAdsRateLimitRetry(() => axios.post(url, body, config), logContext);
}

/**
 * @param {string} url
 * @param {import('axios').AxiosRequestConfig} config
 * @param {{ operation?: string, action?: string, customerIds?: Array<string | number | null | undefined> }} [logContext]
 */
async function googleAdsGet(url, config, logContext = {}) {
  return axiosWithGoogleAdsRateLimitRetry(() => axios.get(url, config), logContext);
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
  getMccGoogleAdsRefreshToken,
  buildGoogleAdsHeaders,
  parseGoogleAdsApiError,
  formatGoogleAdsApiErrorMessage,
  extractGoogleAdsErrorDetails,
  summarizeGoogleAdsApiErrorDetails,
  createGoogleAdsApiErrorFromResponse,
  isConversionActionCreationEnabled,
  parseRetryAfterMs,
  googleAdsRateLimitWaitMs,
  axiosWithGoogleAdsRateLimitRetry,
  getGoogleAdsRateLimitMaxAttempts,
  googleAdsPost,
  googleAdsGet,
};
