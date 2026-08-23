'use strict';

const crypto = require('crypto');
const {
  encryptToken,
  decryptToken,
  isV1Encrypted,
  V1_PREFIX,
} = require('../lib/crypto/tokenEncryption');

const KEY_A =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const KEY_B =
  'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';

function encryptLegacyV0(plaintext, hexKey) {
  const key = Buffer.from(hexKey, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

describe('tokenEncryption', () => {
  it('round-trips plaintext tokens as v1', () => {
    const plain = 'ya29.super-secret-access-token-value';
    const enc = encryptToken(plain);
    expect(enc.startsWith(V1_PREFIX)).toBe(true);
    expect(enc).not.toContain(plain);
    expect(decryptToken(enc)).toBe(plain);
    expect(isV1Encrypted(enc)).toBe(true);
  });

  it('decrypts legacy v0 blobs', () => {
    const plain = 'legacy-refresh-token';
    const v0 = encryptLegacyV0(plain, KEY_A);
    expect(isV1Encrypted(v0)).toBe(false);
    process.env.TOKEN_ENCRYPTION_KEY = KEY_A;
    expect(decryptToken(v0)).toBe(plain);
  });

  it('dual-reads v0 blobs with TOKEN_ENCRYPTION_KEY_PREVIOUS', () => {
    const plain = 'rotated-token';
    const v0 = encryptLegacyV0(plain, KEY_A);
    process.env.TOKEN_ENCRYPTION_KEY = KEY_B;
    process.env.TOKEN_ENCRYPTION_KEY_PREVIOUS = KEY_A;
    expect(decryptToken(v0)).toBe(plain);
  });

  it('throws when TOKEN_ENCRYPTION_KEY is missing', () => {
    const prev = process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken('x')).toThrow(/TOKEN_ENCRYPTION_KEY/);
    process.env.TOKEN_ENCRYPTION_KEY = prev;
  });
});
