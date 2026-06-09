'use strict';

const { verifyJwtConfigured } = require('./tokens');
const { verifyTokenEncryptionConfigured } = require('../crypto/tokenEncryption');

/**
 * Fails API startup when auth/OAuth prerequisites are missing (skipped in NODE_ENV=test).
 * JWT_SECRET — session tokens. TOKEN_ENCRYPTION_KEY — OAuth token encryption (required in mock too).
 */
function assertAuthEnvironment() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  if (nodeEnv === 'test') return;
  verifyJwtConfigured();
  verifyTokenEncryptionConfigured();
}

/** Worker process: OAuth activities decrypt tokens; encryption key required at boot. */
function assertWorkerEnvironment() {
  const nodeEnv = process.env.NODE_ENV || 'development';
  if (nodeEnv === 'test') return;
  verifyTokenEncryptionConfigured();
}

module.exports = { assertAuthEnvironment, assertWorkerEnvironment };
