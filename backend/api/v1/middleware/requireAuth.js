'use strict';

const mongoose = require('mongoose');
const User = mongoose.model('User');
const { AUTH_ACCESS_COOKIE_NAME } = require('../../../lib/auth/constants');
const { verifyAccessToken } = require('../../../lib/auth/tokens');

/**
 * Validates JWT cookie, loads User, attaches `req.user = { id, email }`.
 */
async function requireAuth(req, res, next) {
  const raw =
    typeof req.cookies?.[AUTH_ACCESS_COOKIE_NAME] === 'string'
      ? req.cookies[AUTH_ACCESS_COOKIE_NAME]
      : '';

  if (!raw) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Authentication required',
    });
  }

  const payload = verifyAccessToken(raw);

  const sub =
    payload && typeof payload === 'object' && typeof payload.sub === 'string' ? payload.sub : null;

  if (!sub || !mongoose.Types.ObjectId.isValid(sub)) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'Invalid or expired session',
    });
  }

  try {
    const user = await User.findById(sub).select('_id email').lean();
    if (!user) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'Invalid or expired session',
      });
    }

    req.user = { id: user._id.toString(), email: user.email };

    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth };
