'use strict';

const { verifyJwtConfigured } = require('./tokens');

/** Fails startup when JWT_SECRET is missing (skipped in NODE_ENV=test for Jest). */
function assertAuthEnvironment() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  if (nodeEnv === 'test') return;
  verifyJwtConfigured();
}

module.exports = { assertAuthEnvironment };
