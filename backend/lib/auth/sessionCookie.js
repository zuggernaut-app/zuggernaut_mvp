'use strict';

const ms = require('ms');
const { AUTH_ACCESS_COOKIE_NAME } = require('./constants');
const { getJwtExpiresInString } = require('./tokens');

function cookieIsSecureDefault() {
  if (resolveCookieSameSite() === 'none') return true;
  if (process.env.COOKIE_SECURE === 'false') return false;
  const env = process.env.NODE_ENV || 'development';
  return env === 'production';
}

/**
 * `none` for cross-origin split hosting (Firebase SPA + Railway API); `lax` for same-site local dev.
 * Override with `COOKIE_SAMESITE=none|lax|strict`.
 */
function resolveCookieSameSite() {
  const override = process.env.COOKIE_SAMESITE?.trim().toLowerCase();
  if (override === 'none' || override === 'lax' || override === 'strict') {
    return override;
  }
  const env = process.env.NODE_ENV || 'development';
  if (env === 'production' && process.env.FRONTEND_ORIGIN?.trim()) {
    return 'none';
  }
  return 'lax';
}

/** Shared attributes for session + CSRF cookies (set and clear must match). */
function sharedCookieAttributes() {
  return {
    path: '/',
    secure: cookieIsSecureDefault(),
    sameSite: resolveCookieSameSite(),
  };
}

/** @param {number} maxAgeMs express `res.cookie` maxAge (milliseconds) */
function accessTokenCookiePayload(maxAgeMs) {
  return {
    name: AUTH_ACCESS_COOKIE_NAME,
    options: {
      ...sharedCookieAttributes(),
      httpOnly: true,
      maxAge: Math.max(0, Math.floor(maxAgeMs)),
    },
  };
}

/** Max-age in milliseconds derived from JWT_EXPIRES_IN (must match issuing side). */
function accessTokenCookieMaxAgeMs() {
  const ttl = ms(getJwtExpiresInString());
  if (typeof ttl !== 'number' || ttl <= 0) {
    return 2 * 60 * 60 * 1000;
  }
  return ttl;
}

/** Options used by `res.clearCookie` — attributes must overlap with set for browsers to drop it. */
function clearAccessTokenCookieAttributes() {
  return {
    ...sharedCookieAttributes(),
    httpOnly: true,
  };
}

module.exports = {
  AUTH_ACCESS_COOKIE_NAME,
  accessTokenCookiePayload,
  accessTokenCookieMaxAgeMs,
  clearAccessTokenCookieAttributes,
  resolveCookieSameSite,
  cookieIsSecureDefault,
  sharedCookieAttributes,
};
