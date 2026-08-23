'use strict';

const crypto = require('crypto');

/** One-time reset token lifetime (1 hour). */
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

const RESET_TOKEN_BYTES = 32;

function generateResetToken() {
  return crypto.randomBytes(RESET_TOKEN_BYTES).toString('base64url');
}

function hashResetToken(plainToken) {
  return crypto.createHash('sha256').update(plainToken, 'utf8').digest('hex');
}

function resetTokenExpiresAt(now = Date.now()) {
  return new Date(now + PASSWORD_RESET_TTL_MS);
}

function isResetTokenExpired(expiresAt, now = Date.now()) {
  if (!expiresAt) return true;
  const ms = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  if (Number.isNaN(ms)) return true;
  return ms <= now;
}

function verifyResetToken(plainToken, storedHash) {
  if (typeof plainToken !== 'string' || plainToken.length === 0) return false;
  if (typeof storedHash !== 'string' || storedHash.length === 0) return false;
  const candidate = hashResetToken(plainToken);
  const a = Buffer.from(candidate, 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = {
  PASSWORD_RESET_TTL_MS,
  generateResetToken,
  hashResetToken,
  resetTokenExpiresAt,
  isResetTokenExpired,
  verifyResetToken,
};
