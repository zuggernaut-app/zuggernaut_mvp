'use strict';

const { verifyTokenEncryptionConfigured } = require('../../../backend/lib/crypto/tokenEncryption');
const { verifyJwtConfigured } = require('../../../backend/lib/auth/tokens');
const { resolveTemporalTaskQueue } = require('../../../backend/constants/temporalDefaults');

function isTruthyMock(value) {
  return value === 'true' || value === '1';
}

function requireNonEmpty(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    return `${name} must be set`;
  }
  return null;
}

/**
 * Preflight checks before real Google + Temporal E2E (no secret values logged).
 * @param {{ nodeEnv?: string }} [options]
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
function verifyRealModeEnvironment(options = {}) {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const errors = [];
  const warnings = [];

  if (nodeEnv === 'test') {
    warnings.push('Skipping strict real-mode checks in NODE_ENV=test');
    return { ok: true, errors, warnings };
  }

  try {
    verifyJwtConfigured();
    verifyTokenEncryptionConfigured();
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  for (const name of ['MONGODB_URI', 'FRONTEND_ORIGIN']) {
    const msg = requireNonEmpty(name);
    if (msg) errors.push(msg);
  }

  for (const name of [
    'GOOGLE_CLIENT_ID',
    'GOOGLE_CLIENT_SECRET',
    'GOOGLE_ADS_DEVELOPER_TOKEN',
    'GOOGLE_ADS_LOGIN_CUSTOMER_ID',
  ]) {
    const msg = requireNonEmpty(name);
    if (msg) errors.push(msg);
  }

  if (isTruthyMock(process.env.GOOGLE_OAUTH_MOCK)) {
    errors.push('GOOGLE_OAUTH_MOCK must be false or unset for real mode');
  }
  if (isTruthyMock(process.env.GTM_API_MOCK)) {
    errors.push('GTM_API_MOCK must be false or unset for real mode');
  }
  if (isTruthyMock(process.env.GOOGLE_ADS_API_MOCK)) {
    errors.push('GOOGLE_ADS_API_MOCK must be false or unset for real mode');
  }
  if (isTruthyMock(process.env.GBP_API_MOCK)) {
    errors.push('GBP_API_MOCK must be false or unset for real mode');
  }

  if (process.env.GTM_API_ENABLED !== 'true') {
    errors.push('GTM_API_ENABLED must be true for real mode');
  }
  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    errors.push('GOOGLE_ADS_API_ENABLED must be true for real mode');
  }
  if (process.env.GBP_API_ENABLED !== 'true') {
    warnings.push('GBP_API_ENABLED is not true — GBP audit will be skipped unless enabled');
  }

  if (isTruthyMock(process.env.TEMPORAL_E2E_MOCK)) {
    errors.push('TEMPORAL_E2E_MOCK must be false or unset (real Temporal required)');
  }

  if (!process.env.TEMPORAL_ADDRESS?.trim()) {
    warnings.push('TEMPORAL_ADDRESS unset — default 127.0.0.1:7233 will be used');
  }

  const taskQueue = resolveTemporalTaskQueue();
  if (!taskQueue) {
    errors.push('TEMPORAL_TASK_QUEUE resolved to empty string');
  }

  return { ok: errors.length === 0, errors, warnings };
}

module.exports = { verifyRealModeEnvironment };
