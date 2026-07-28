'use strict';

const axios = require('axios');
const mongoose = require('mongoose');
const {
  fetchGoogleAdsConversionCatalog,
  normalizeConversionAction,
} = require('../services/integrations/googleAdsConversionCatalogClient');
const { GoogleAdsApiError } = require('../services/integrations/googleAdsApiConfig');
const { resetProviderRateLimitsForTests } = require('../lib/providerRateLimit');

jest.mock('axios');
jest.mock('../services/integrations/googleTokenService', () => ({
  getFreshGoogleAccessToken: jest.fn().mockResolvedValue('customer-oauth-token'),
  getMccGoogleAdsAccessToken: jest.fn().mockResolvedValue('mcc-admin-token'),
}));

const {
  getFreshGoogleAccessToken,
  getMccGoogleAdsAccessToken,
} = require('../services/integrations/googleTokenService');

describe('googleAdsConversionCatalogClient', () => {
  const managerId = '2940178860';
  const clientId = '8383537213';

  beforeEach(async () => {
    resetProviderRateLimitsForTests();
    jest.clearAllMocks();
    process.env.GOOGLE_ADS_API_MOCK = 'false';
    process.env.GOOGLE_ADS_API_ENABLED = 'true';
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = managerId;
    process.env.GOOGLE_ADS_MCC_REFRESH_TOKEN = 'mcc-refresh-token';

    axios.post.mockResolvedValue({
      status: 200,
      data: {
        results: [
          {
            conversionAction: {
              id: '1001',
              resourceName: `customers/${clientId}/conversionActions/1001`,
              name: 'Phone calls from ads',
              category: 'PHONE_CALL_LEAD',
              status: 'ENABLED',
              type: 'AD_CALL',
              includeInConversionsMetric: true,
            },
          },
        ],
      },
    });
  });

  afterEach(() => {
    process.env.GOOGLE_ADS_API_MOCK = 'true';
    delete process.env.GOOGLE_ADS_API_ENABLED;
  });

  async function seedAdsConnection(providerIdentifiers) {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');

    const user = await User.create({ email: `catalog-auth-${Date.now()}@test.com` });
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

    await fetchGoogleAdsConversionCatalog({ businessId, customerId: clientId });

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

    await fetchGoogleAdsConversionCatalog({ businessId, customerId: clientId });

    expect(getFreshGoogleAccessToken).toHaveBeenCalledWith({
      businessId,
      provider: 'google_ads',
    });
    expect(getMccGoogleAdsAccessToken).not.toHaveBeenCalled();

    const [, , config] = axios.post.mock.calls[0];
    expect(config.headers.Authorization).toBe('Bearer customer-oauth-token');
    expect(config.headers['login-customer-id']).toBe(managerId);
  });

  it('retries confirmed 429 responses before succeeding', async () => {
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
              conversionAction: {
                id: '1001',
                resourceName: `customers/${clientId}/conversionActions/1001`,
                name: 'Phone calls from ads',
                category: 'PHONE_CALL_LEAD',
                status: 'ENABLED',
                type: 'AD_CALL',
                includeInConversionsMetric: true,
              },
            },
          ],
        },
      });

    await fetchGoogleAdsConversionCatalog({ businessId, customerId: clientId });

    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('normalizes search result rows and filters invalid entries', () => {
    expect(
      normalizeConversionAction({
        id: 1001,
        resourceName: `customers/${clientId}/conversionActions/1001`,
        name: 'Phone calls',
        category: 'PHONE_CALL_LEAD',
        status: 'ENABLED',
        type: 'AD_CALL',
        includeInConversionsMetric: true,
      })
    ).toEqual({
      externalId: '1001',
      resourceName: `customers/${clientId}/conversionActions/1001`,
      name: 'Phone calls',
      category: 'PHONE_CALL_LEAD',
      status: 'ENABLED',
      type: 'AD_CALL',
      includeInConversionsMetric: true,
    });

    expect(normalizeConversionAction({ id: '1002' })).toEqual({
      externalId: '1002',
      resourceName: 'customers/unknown/conversionActions/1002',
      name: null,
      category: null,
      status: null,
      type: null,
      includeInConversionsMetric: false,
    });

    expect(normalizeConversionAction(null)).toBeNull();
  });

  it('parses multiple conversion actions from search response', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        results: [
          {
            conversionAction: {
              id: '1001',
              resourceName: `customers/${clientId}/conversionActions/1001`,
              name: 'Phone calls from ads',
              category: 'PHONE_CALL_LEAD',
              status: 'ENABLED',
              type: 'AD_CALL',
              includeInConversionsMetric: true,
            },
          },
          {
            conversionAction: {
              id: '1002',
              resourceName: `customers/${clientId}/conversionActions/1002`,
              name: 'Website form submit',
              category: 'SUBMIT_LEAD_FORM',
              status: 'ENABLED',
              type: 'WEBPAGE',
              includeInConversionsMetric: false,
            },
          },
          { conversionAction: { status: 'REMOVED' } },
        ],
      },
    });

    const businessId = await seedAdsConnection({
      customerId: clientId,
      mccLink: {
        status: 'ACTIVE',
        managerCustomerId: managerId,
        clientCustomerId: clientId,
      },
    });

    const catalog = await fetchGoogleAdsConversionCatalog({ businessId, customerId: clientId });

    expect(catalog.source).toBe('google_ads_api');
    expect(catalog.conversionActions).toHaveLength(2);
    expect(catalog.conversionActions[1]).toMatchObject({
      externalId: '1002',
      includeInConversionsMetric: false,
    });
  });

  it('throws GOOGLE_ADS_CATALOG_SEARCH_FAILED when search returns non-2xx', async () => {
    axios.post.mockResolvedValue({
      status: 403,
      data: { error: { message: 'permission denied' } },
    });

    const businessId = await seedAdsConnection({
      customerId: clientId,
      mccLink: {
        status: 'ACTIVE',
        managerCustomerId: managerId,
        clientCustomerId: clientId,
      },
    });

    await expect(
      fetchGoogleAdsConversionCatalog({ businessId, customerId: clientId })
    ).rejects.toMatchObject({
      code: 'GOOGLE_ADS_CATALOG_SEARCH_FAILED',
    });
  });

  it('throws GOOGLE_ADS_NO_CONVERSION_ACTIONS when search returns no usable rows', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { results: [] },
    });

    const businessId = await seedAdsConnection({
      customerId: clientId,
      mccLink: {
        status: 'REQUIRED',
        managerCustomerId: managerId,
        clientCustomerId: clientId,
      },
    });

    await expect(
      fetchGoogleAdsConversionCatalog({ businessId, customerId: clientId })
    ).rejects.toBeInstanceOf(GoogleAdsApiError);

    await expect(
      fetchGoogleAdsConversionCatalog({ businessId, customerId: clientId })
    ).rejects.toMatchObject({
      code: 'GOOGLE_ADS_NO_CONVERSION_ACTIONS',
    });
  });
});
