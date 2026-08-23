'use strict';

const crypto = require('crypto');
const { CSRF_COOKIE_NAME } = require('./constants');
const { sharedCookieAttributes } = require('./sessionCookie');

const CSRF_TOKEN_BYTES = 32;

function generateCsrfToken() {
  return crypto.randomBytes(CSRF_TOKEN_BYTES).toString('base64url');
}

/** @param {string} token */
function csrfCookiePayload(token) {
  return {
    name: CSRF_COOKIE_NAME,
    value: token,
    options: {
      ...sharedCookieAttributes(),
      httpOnly: false,
      maxAge: 24 * 60 * 60 * 1000,
    },
  };
}

/**
 * @param {string | undefined} cookieToken
 * @param {string | undefined} headerToken
 */
function csrfTokensMatch(cookieToken, headerToken) {
  if (typeof cookieToken !== 'string' || cookieToken.length === 0) return false;
  if (typeof headerToken !== 'string' || headerToken.length === 0) return false;
  const cookieBuf = Buffer.from(cookieToken);
  const headerBuf = Buffer.from(headerToken);
  if (cookieBuf.length !== headerBuf.length) return false;
  return crypto.timingSafeEqual(cookieBuf, headerBuf);
}

/**
 * Set (or refresh) the CSRF double-submit cookie on the response.
 * @param {import('express').Response} res
 * @param {string} [token]
 */
function issueCsrfCookie(res, token = generateCsrfToken()) {
  const cookie = csrfCookiePayload(token);
  res.cookie(cookie.name, cookie.value, cookie.options);
  return token;
}

module.exports = {
  generateCsrfToken,
  csrfCookiePayload,
  csrfTokensMatch,
  issueCsrfCookie,
};
