'use strict';

const {
  AUTH_ACCESS_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} = require('../../../lib/auth/constants');
const { csrfTokensMatch } = require('../../../lib/auth/csrf');

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Require a matching CSRF double-submit token on mutating requests that carry the auth cookie.
 * Safe methods and unauthenticated mutating requests (register/login) are not checked.
 */
function csrfProtection(req, res, next) {
  if (!MUTATING_METHODS.has(req.method)) {
    return next();
  }

  const hasAuthCookie =
    typeof req.cookies?.[AUTH_ACCESS_COOKIE_NAME] === 'string' &&
    req.cookies[AUTH_ACCESS_COOKIE_NAME].length > 0;

  if (!hasAuthCookie) {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME];

  if (!csrfTokensMatch(cookieToken, headerToken)) {
    return res.status(403).json({
      error: 'csrf_invalid',
      message: 'CSRF token missing or invalid',
    });
  }

  return next();
}

module.exports = { csrfProtection };
