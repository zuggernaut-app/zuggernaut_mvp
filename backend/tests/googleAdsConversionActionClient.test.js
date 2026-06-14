'use strict';

const axios = require('axios');
const {
  createConversionAction,
  createConversionActionMock,
  mockExternalIdFromIdempotencyKey,
} = require('../services/integrations/googleAdsConversionActionClient');
const { resetProviderRateLimitsForTests } = require('../lib/providerRateLimit');

jest.mock('axios');
jest.mock('../services/integrations/googleTokenService', () => ({
  getFreshGoogleAccessToken: jest.fn().mockResolvedValue('test-access-token'),
}));

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
