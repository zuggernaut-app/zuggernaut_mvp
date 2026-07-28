'use strict';

const axios = require('axios');
const mongoose = require('mongoose');
const {
  createConversionAction,
  createConversionActionMock,
  mockExternalIdFromIdempotencyKey,
} = require('../services/integrations/googleAdsConversionActionClient');
const { resetProviderRateLimitsForTests } = require('../lib/providerRateLimit');

jest.mock('axios');
jest.mock('../services/integrations/googleTokenService', () => ({
  getFreshGoogleAccessToken: jest.fn().mockResolvedValue('test-access-token'),
  getMccGoogleAdsAccessToken: jest.fn().mockResolvedValue('mcc-admin-token'),
}));

const {
  getFreshGoogleAccessToken,
  getMccGoogleAdsAccessToken,
} = require('../services/integrations/googleTokenService');

describe('googleAdsConversionActionClient', () => {
  const baseCtx = {
    businessId: '507f1f77bcf86cd799439011',
    customerId: '1234567890',
    conversionActionConfig: {
      name: 'Phone Call Conversions — Zuggernaut',
      category: 'PHONE_CALL_LEAD',
      type: 'AD_CALL',
      countingType: 'ONE_PER_CLICK',
      defaultValue: 0,
      alwaysUseDefaultValue: true,
      status: 'ENABLED',
      includeInConversionsMetric: true,
    },
    idempotencyKey: 'ads-ca-create-run-call',
  };

  beforeEach(() => {
    resetProviderRateLimitsForTests();
    jest.clearAllMocks();
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
    delete process.env.GOOGLE_ADS_CONVERSION_ACTION_CREATION_ENABLED;
  });

  afterEach(() => {
    process.env.GOOGLE_ADS_API_MOCK = 'true';
    delete process.env.GOOGLE_ADS_API_ENABLED;
    delete process.env.GOOGLE_ADS_CONVERSION_ACTION_CREATION_ENABLED;
  });

  it('createConversionActionMock returns stable mock ids from idempotency key', async () => {
    const result = await createConversionActionMock(baseCtx);
    expect(result.source).toBe('google_ads_api_mock');
    expect(result.externalId).toBe(mockExternalIdFromIdempotencyKey(baseCtx.idempotencyKey));
    expect(result.resourceName).toContain('customers/1234567890/conversionActions/');
  });

  it('createConversionAction uses mock path when GOOGLE_ADS_API_MOCK=true', async () => {
    process.env.GOOGLE_ADS_API_MOCK = 'true';

    const result = await createConversionAction(baseCtx);
    expect(result.source).toBe('google_ads_api_mock');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('createConversionAction throws when API is not enabled', async () => {
    process.env.GOOGLE_ADS_API_MOCK = 'false';
    process.env.GOOGLE_ADS_API_ENABLED = 'false';

    await expect(createConversionAction(baseCtx)).rejects.toMatchObject({
      code: 'GOOGLE_ADS_API_NOT_ENABLED',
    });
  });

  it('createConversionAction throws when creation flag is disabled', async () => {
    process.env.GOOGLE_ADS_API_MOCK = 'false';
    process.env.GOOGLE_ADS_API_ENABLED = 'true';

    await expect(createConversionAction(baseCtx)).rejects.toMatchObject({
      code: 'GOOGLE_ADS_CONVERSION_CREATION_DISABLED',
    });
  });

  it('createConversionAction calls conversionActions:mutate when flag enabled', async () => {
    process.env.GOOGLE_ADS_API_MOCK = 'false';
    process.env.GOOGLE_ADS_API_ENABLED = 'true';
    process.env.GOOGLE_ADS_CONVERSION_ACTION_CREATION_ENABLED = 'true';

    axios.post.mockResolvedValue({
      status: 200,
      data: {
        results: [{ resourceName: 'customers/1234567890/conversionActions/9001' }],
      },
    });

    const result = await createConversionAction(baseCtx);
    expect(result.source).toBe('google_ads_api');
    expect(result.externalId).toBe('9001');
    expect(result.resourceName).toBe('customers/1234567890/conversionActions/9001');

    const [url, body] = axios.post.mock.calls[0];
    expect(url).toContain('/customers/1234567890/conversionActions:mutate');
    expect(body.operations[0].create.name).toBe(baseCtx.conversionActionConfig.name);
    expect(body.operations[0].create.type).toBe('AD_CALL');
    expect(body.operations[0].create.valueSettings).toEqual({
      defaultValue: 0,
      alwaysUseDefaultValue: true,
    });
    expect(body.operations[0].create.defaultValue).toBeUndefined();
    expect(body.operations[0].create.includeInConversionsMetric).toBeUndefined();
  });

  describe('createConversionAction auth', () => {
    const managerId = '2940178860';
    const clientId = '8383537213';

    beforeEach(() => {
      resetProviderRateLimitsForTests();
      process.env.GOOGLE_ADS_API_MOCK = 'false';
      process.env.GOOGLE_ADS_API_ENABLED = 'true';
      process.env.GOOGLE_ADS_CONVERSION_ACTION_CREATION_ENABLED = 'true';
      process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = managerId;
      process.env.GOOGLE_ADS_MCC_REFRESH_TOKEN = 'mcc-refresh-token';
      axios.post.mockResolvedValue({
        status: 200,
        data: {
          results: [{ resourceName: `customers/${clientId}/conversionActions/9001` }],
        },
      });
    });

    async function seedAdsConnection(providerIdentifiers) {
      const User = mongoose.model('User');
      const BusinessContext = mongoose.model('BusinessContext');
      const IntegrationConnection = mongoose.model('IntegrationConnection');

      const user = await User.create({ email: `ca-auth-${Date.now()}@test.com` });
      const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
      await IntegrationConnection.create({
        businessId: bc.businessId,
        provider: 'google_ads',
        connectionHealth: 'connected',
        accessTokenEnc: 'x',
        refreshTokenEnc: 'y',
        tokenExpiryAt: new Date(Date.now() + 3600_000),
        scopes: ['https://www.googleapis.com/auth/adwords'],
        providerIdentifiers,
      });

      return bc.businessId;
    }

    it('uses MCC admin token and login-customer-id when mccLink is active', async () => {
      const businessId = await seedAdsConnection({
        customerId: clientId,
        mccLink: {
          status: 'ACTIVE',
          managerCustomerId: managerId,
          clientCustomerId: clientId,
        },
      });

      await createConversionAction({
        ...baseCtx,
        businessId,
        customerId: clientId,
      });

      expect(getMccGoogleAdsAccessToken).toHaveBeenCalled();
      expect(getFreshGoogleAccessToken).not.toHaveBeenCalled();

      const [, , config] = axios.post.mock.calls[0];
      expect(config.headers.Authorization).toBe('Bearer mcc-admin-token');
      expect(config.headers['login-customer-id']).toBe(managerId);
    });

    it('uses customer OAuth token when mccLink is not active', async () => {
      const businessId = await seedAdsConnection({
        customerId: clientId,
        mccLink: {
          status: 'REQUIRED',
          managerCustomerId: managerId,
          clientCustomerId: clientId,
        },
      });

      await createConversionAction({
        ...baseCtx,
        businessId,
        customerId: clientId,
      });

      expect(getFreshGoogleAccessToken).toHaveBeenCalled();
      expect(getMccGoogleAdsAccessToken).not.toHaveBeenCalled();

      const [, , config] = axios.post.mock.calls[0];
      expect(config.headers.Authorization).toBe('Bearer test-access-token');
      expect(config.headers['login-customer-id']).toBe(managerId);
    });

    it('retries confirmed 429 responses before succeeding', async () => {
      process.env.GOOGLE_ADS_API_MOCK = 'false';
      process.env.GOOGLE_ADS_API_ENABLED = 'true';
      process.env.GOOGLE_ADS_CONVERSION_ACTION_CREATION_ENABLED = 'true';
      process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = managerId;
      process.env.GOOGLE_ADS_RATE_LIMIT_MAX_ATTEMPTS = '3';
      process.env.GOOGLE_ADS_RATE_LIMIT_BASE_MS = '1';
      process.env.GOOGLE_ADS_RATE_LIMIT_MAX_WAIT_MS = '10';

      const businessId = await seedAdsConnection({
        customerId: clientId,
        mccLink: {
          status: 'ACTIVE',
          managerCustomerId: managerId,
          clientCustomerId: clientId,
        },
      });

      axios.post
        .mockResolvedValueOnce({ status: 429, headers: {}, data: {} })
        .mockResolvedValueOnce({
          status: 200,
          data: {
            results: [
              {
                resourceName: `customers/${clientId}/conversionActions/1001`,
              },
            ],
          },
        });

      const result = await createConversionAction({
        ...baseCtx,
        businessId,
        customerId: clientId,
      });

      expect(result.resourceName).toBe(`customers/${clientId}/conversionActions/1001`);
      expect(axios.post).toHaveBeenCalledTimes(2);
    });
  });

  it('buildConversionActionCreatePayload omits valueSettings for types that do not support them', () => {
    const { buildConversionActionCreatePayload } = require('../services/integrations/googleAdsConversionActionClient');
    const payload = buildConversionActionCreatePayload({
      name: 'Test',
      category: 'DEFAULT',
      type: 'CLICK_TO_CALL',
      countingType: 'ONE_PER_CLICK',
      defaultValue: 0,
      alwaysUseDefaultValue: true,
      status: 'ENABLED',
    });
    expect(payload.valueSettings).toBeUndefined();
    expect(payload.defaultValue).toBeUndefined();
  });
});
