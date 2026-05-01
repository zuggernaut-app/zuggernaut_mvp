'use strict';

const mongoose = require('mongoose');

const User = mongoose.model('User');

/**
 * Dev-only identity: replace with JWT/session middleware later.
 * Expects `x-dev-user-id` header with a valid Mongo ObjectId (from POST /users).
 */
async function devUserRequired(req, res, next) {
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
  } catch {
    return res.status(503).json({
      error: 'service_unavailable',
      message:
        'Database query failed. Ensure MongoDB is running and MONGODB_URI is set; the API may have started before Mongo connected.',
    });
  }
  req.devUserId = id;
  next();
}

module.exports = { devUserRequired };
