'use strict';

const rateLimit = require('express-rate-limit');

/** 10 failed login attempts per account email per 15 minutes (login route only). */
const loginFailedLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email =
      typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    return email || 'login:missing-email';
  },
  message: {
    error: 'rate_limit_exceeded',
    message: 'Too many failed login attempts. Try again shortly.',
  },
});

module.exports = { loginFailedLimiter };
