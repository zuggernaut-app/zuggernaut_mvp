'use strict';

const crypto = require('crypto');

const REQUEST_ID_HEADER = 'x-request-id';
const MAX_REQUEST_ID_LENGTH = 128;

/**
 * @param {string | string[] | undefined} value
 * @returns {string | null}
 */
function normalizeIncomingRequestId(value) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== 'string') {
    return null;
  }

  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_REQUEST_ID_LENGTH) {
    return null;
  }

  return trimmed;
}

/**
 * Attach a request ID to each HTTP request/response for log correlation.
 */
function requestIdMiddleware(req, res, next) {
  const requestId = normalizeIncomingRequestId(req.headers[REQUEST_ID_HEADER]) ?? crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
}

module.exports = {
  REQUEST_ID_HEADER,
  requestIdMiddleware,
  normalizeIncomingRequestId,
};
