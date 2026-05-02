'use strict';

const mongoose = require('mongoose');
const { createLogger } = require('../../../lib/observability/logger');

const User = mongoose.model('User');
const logger = createLogger({ name: 'devUserMiddleware' });

function isDevUserAuthAllowed() {
  if (process.env.ALLOW_DEV_USER_AUTH === 'true') return true;
  const env = process.env.NODE_ENV || 'development';
  return env !== 'production';
}

/**
 * Dev-only identity: replace with JWT/session middleware later.
 * Expects `x-dev-user-id` header with a valid Mongo ObjectId (from POST /users).
 *
 * Disabled when NODE_ENV is `production` unless ALLOW_DEV_USER_AUTH=true (staging/demo only).
 */
async function devUserRequired(req, res, next) {
  if (!isDevUserAuthAllowed()) {
    return res.status(403).json({
      error: 'forbidden',
      message:
        'Dev header authentication is disabled in this environment. Use real auth or set ALLOW_DEV_USER_AUTH=true only for controlled non-prod/staging.',
    });
  }

  const raw = req.headers['x-dev-user-id'];
  if (!raw || typeof raw !== 'string' || !mongoose.Types.ObjectId.isValid(raw.trim())) {
    return res.status(401).json({
      error: 'unauthorized',
      message:
        'Missing or invalid x-dev-user-id header. In production this becomes session/JWT.',
    });
  }
  const id = new mongoose.Types.ObjectId(raw.trim());
  try {
    const exists = await User.exists({ _id: id });
    if (!exists) {
      return res.status(401).json({
        error: 'unauthorized',
        message: 'No user found for x-dev-user-id; create one with POST /api/v1/users first.',
      });
    }
  } catch (err) {
    logger.error({ err }, 'devUserRequired User.exists failed');
    return res.status(503).json({
      error: 'service_unavailable',
      message:
        'Database query failed. Ensure MongoDB is running and MONGODB_URI is set; the API may have started before Mongo connected.',
    });
  }
  req.devUserId = id;
  next();
}

module.exports = { devUserRequired, isDevUserAuthAllowed };
