'use strict';

const crypto = require('crypto');

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const V1_PREFIX = 'enc:v1:';

function verifyTokenEncryptionConfigured() {
  if (process.env.NODE_ENV === 'test') return;
  getEncryptionKey();
}

function parseKeyMaterial(raw, envName) {
  if (!raw) {
    throw new Error(
      `${envName} must be set in backend/.env (64 hex chars or base64-encoded 32 bytes). ` +
        'OAuth integrations encrypt refresh tokens at rest — required even when GOOGLE_OAUTH_MOCK=true.'
    );
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, 'hex');
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== 32) {
    throw new Error(
      `${envName} must be 32 bytes (64 hex chars or base64-encoded 32 bytes). ` +
        'Generate hex: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    );
  }
  return buf;
}

function getEncryptionKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY?.trim();
  return parseKeyMaterial(raw, 'TOKEN_ENCRYPTION_KEY');
}

/**
 * @returns {Buffer | null}
 */
function getPreviousEncryptionKey() {
  const raw = process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS?.trim();
  if (!raw) return null;
  return parseKeyMaterial(raw, 'TOKEN_ENCRYPTION_KEY_PREVIOUS');
}

/**
 * @param {string} encoded
 */
function isV1Encrypted(encoded) {
  return typeof encoded === 'string' && encoded.startsWith(V1_PREFIX);
}

/**
 * @param {Buffer} key
 * @param {Buffer} buf
 * @returns {string}
 */
function decryptPayloadWithKey(key, buf) {
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

/**
 * @param {string} encoded
 * @param {Buffer[]} keys
 * @returns {string}
 */
function decryptWithKeys(encoded, keys) {
  const payloadBase64 = isV1Encrypted(encoded) ? encoded.slice(V1_PREFIX.length) : encoded;
  const buf = Buffer.from(payloadBase64, 'base64');
  let lastErr;
  for (const key of keys) {
    try {
      return decryptPayloadWithKey(key, buf);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr ?? new Error('decryptToken failed');
}

/**
 * @param {string} plaintext
 * @returns {string} enc:v1:base64(iv:ciphertext:tag)
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
  const payload = Buffer.concat([iv, tag, encrypted]).toString('base64');
  return `${V1_PREFIX}${payload}`;
}

/**
 * @param {string} encoded
 * @returns {string}
 */
function decryptToken(encoded) {
  if (typeof encoded !== 'string' || !encoded) {
    throw new Error('decryptToken requires non-empty string');
  }
  const keys = [getEncryptionKey()];
  const previous = getPreviousEncryptionKey();
  if (previous) keys.push(previous);
  return decryptWithKeys(encoded, keys);
}

module.exports = {
  encryptToken,
  decryptToken,
  getEncryptionKey,
  getPreviousEncryptionKey,
  isV1Encrypted,
  verifyTokenEncryptionConfigured,
  V1_PREFIX,
};
