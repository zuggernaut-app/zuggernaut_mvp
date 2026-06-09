'use strict';

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

function verifyTokenEncryptionConfigured() {
  if (process.env.NODE_ENV === 'test') return;
  getEncryptionKey();
}

function getEncryptionKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY must be set in backend/.env (64 hex chars or base64-encoded 32 bytes). ' +
        'OAuth integrations encrypt refresh tokens at rest — required even when GOOGLE_OAUTH_MOCK=true.'
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(
      'TOKEN_ENCRYPTION_KEY must be 32 bytes (64 hex chars or base64-encoded 32 bytes). ' +
        'Generate hex: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return buf;
}

/**
 * @param {string} plaintext
 * @returns {string} base64(iv:ciphertext:tag)
 */
function encryptToken(plaintext) {
  if (typeof plaintext !== 'string' || !plaintext) {
    throw new Error('encryptToken requires non-empty string');
  }
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

/**
 * @param {string} encoded
 * @returns {string}
 */
function decryptToken(encoded) {
  if (typeof encoded !== 'string' || !encoded) {
    throw new Error('decryptToken requires non-empty string');
  }
  const key = getEncryptionKey();
  const buf = Buffer.from(encoded, 'base64');
  if (buf.length < IV_BYTES + 16 + 1) {
    throw new Error('Invalid encrypted token payload');
  }
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + 16);
  const ciphertext = buf.subarray(IV_BYTES + 16);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

module.exports = { encryptToken, decryptToken, getEncryptionKey, verifyTokenEncryptionConfigured };
