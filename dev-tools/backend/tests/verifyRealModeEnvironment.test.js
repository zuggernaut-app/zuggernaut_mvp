'use strict';

const { verifyRealModeEnvironment } = require('../lib/verifyRealModeEnvironment');

describe('verifyRealModeEnvironment', () => {
  const baseRealEnv = {
    NODE_ENV: 'development',
    JWT_SECRET: 'x'.repeat(32),
    TOKEN_ENCRYPTION_KEY:
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    MONGODB_URI: 'mongodb://127.0.0.1:27017/test',
    FRONTEND_ORIGIN: 'http://localhost:5173',
    GOOGLE_CLIENT_ID: 'client-id',
    GOOGLE_CLIENT_SECRET: 'client-secret',
    GOOGLE_ADS_DEVELOPER_TOKEN: 'dev-token',
    GOOGLE_ADS_LOGIN_CUSTOMER_ID: '1234567890',
    GOOGLE_OAUTH_MOCK: 'false',
    GTM_API_MOCK: 'false',
    GOOGLE_ADS_API_MOCK: 'false',
    GBP_API_MOCK: 'false',
    GTM_API_ENABLED: 'true',
    GOOGLE_ADS_API_ENABLED: 'true',
    TEMPORAL_E2E_MOCK: 'false',
  };

  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  function withEnv(overrides = {}) {
    process.env = { ...baseRealEnv, ...overrides };
    return verifyRealModeEnvironment();
  }

  it('passes when real-mode flags and credentials are configured', () => {
    const result = withEnv();
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails when mock flags remain enabled', () => {
    const result = withEnv({ GOOGLE_OAUTH_MOCK: 'true' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /GOOGLE_OAUTH_MOCK/i.test(e))).toBe(true);
  });

  it('fails when TEMPORAL_E2E_MOCK is enabled', () => {
    const result = withEnv({ TEMPORAL_E2E_MOCK: 'true' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /TEMPORAL_E2E_MOCK/i.test(e))).toBe(true);
  });

  it('fails when Google Ads credentials are missing', () => {
    const result = withEnv({ GOOGLE_ADS_DEVELOPER_TOKEN: '' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => /GOOGLE_ADS_DEVELOPER_TOKEN/i.test(e))).toBe(true);
  });
});
