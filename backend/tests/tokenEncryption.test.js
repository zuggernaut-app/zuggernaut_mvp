'use strict';

const { encryptToken, decryptToken } = require('../lib/crypto/tokenEncryption');

describe('tokenEncryption', () => {
  it('round-trips plaintext tokens', () => {
    const plain = 'ya29.super-secret-access-token-value';
    const enc = encryptToken(plain);
    expect(enc).not.toContain(plain);
    expect(decryptToken(enc)).toBe(plain);
  });

  it('throws when TOKEN_ENCRYPTION_KEY is missing', () => {
    const prev = process.env.TOKEN_ENCRYPTION_KEY;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken('x')).toThrow(/TOKEN_ENCRYPTION_KEY/);
    process.env.TOKEN_ENCRYPTION_KEY = prev;
  });
});
