'use strict';

const ms = require('ms');
const { AUTH_ACCESS_COOKIE_NAME } = require('./constants');
const { getJwtExpiresInString } = require('./tokens');

function cookieIsSecureDefault() {
  if (process.env.COOKIE_SECURE === 'false') return false;
  const env = process.env.NODE_ENV || 'development';
  return env === 'production';
}

/** @param {number} maxAgeMs express `res.cookie` maxAge (milliseconds) */
function accessTokenCookiePayload(maxAgeMs) {
  return {
    name: AUTH_ACCESS_COOKIE_NAME,
    options: {
      httpOnly: true,
      secure: cookieIsSecureDefault(),
      sameSite: 'lax',
      path: '/',
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
    path: '/',
    httpOnly: true,
    secure: cookieIsSecureDefault(),
    sameSite: 'lax',
  };
}

module.exports = {
  AUTH_ACCESS_COOKIE_NAME,
  accessTokenCookiePayload,
  accessTokenCookieMaxAgeMs,
  clearAccessTokenCookieAttributes,
};
