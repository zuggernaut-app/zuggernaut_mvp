'use strict';

const { assertAuthEnvironment, assertWorkerEnvironment } = require('../lib/auth/assertAuthEnvironment');

describe('assertAuthEnvironment', () => {
  const prevEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...prevEnv };
  });

  it('skips validation in NODE_ENV=test', () => {
    process.env.NODE_ENV = 'test';
    delete process.env.JWT_SECRET;
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => assertAuthEnvironment()).not.toThrow();
  });

  it('throws when JWT_SECRET is missing outside test', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;
    process.env.TOKEN_ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    expect(() => assertAuthEnvironment()).toThrow(/JWT_SECRET must be set/);
  });

  it('throws when TOKEN_ENCRYPTION_KEY is missing outside test', () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'x'.repeat(32);
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => assertAuthEnvironment()).toThrow(/TOKEN_ENCRYPTION_KEY must be set/);
  });

  it('passes when JWT and encryption key are configured', () => {
    process.env.NODE_ENV = 'development';
    process.env.JWT_SECRET = 'x'.repeat(32);
    process.env.TOKEN_ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    expect(() => assertAuthEnvironment()).not.toThrow();
  });

  it('requires JWT and encryption key when NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.JWT_SECRET;
    process.env.TOKEN_ENCRYPTION_KEY =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    expect(() => assertAuthEnvironment()).toThrow(/JWT_SECRET must be set/);

    process.env.JWT_SECRET = 'x'.repeat(32);
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => assertAuthEnvironment()).toThrow(/TOKEN_ENCRYPTION_KEY must be set/);
  });
});

describe('assertWorkerEnvironment', () => {
  const prevEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...prevEnv };
  });

  it('throws when TOKEN_ENCRYPTION_KEY is missing outside test', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.TOKEN_ENCRYPTION_KEY;
    expect(() => assertWorkerEnvironment()).toThrow(/TOKEN_ENCRYPTION_KEY must be set/);
  });
});
