'use strict';

/** HttpOnly JWT cookie presented on same-site API requests */
const AUTH_ACCESS_COOKIE_NAME = 'zugg_access';

/** Non-httpOnly double-submit CSRF cookie (paired with `X-CSRF-Token` header) */
const CSRF_COOKIE_NAME = 'zugg_csrf';

/** Request header carrying the CSRF token (must match `CSRF_COOKIE_NAME` cookie) */
const CSRF_HEADER_NAME = 'x-csrf-token';

module.exports = {
  AUTH_ACCESS_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
};
