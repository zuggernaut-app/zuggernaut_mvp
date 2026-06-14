'use strict';

const mongoose = require('mongoose');
const axios = require('axios');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { resetProviderRateLimitsForTests } = require('../lib/providerRateLimit');
const {
  listGoogleAdsResourceOptions,
  saveGoogleAdsSelection,
  GoogleAdsResourceSelectionError,
} = require('../services/integrations/googleAdsResourceSelectionService');

jest.mock('axios');

describe('googleAdsResourceSelectionService', () => {
  beforeEach(() => {
    resetProviderRateLimitsForTests();
    jest.clearAllMocks();
    process.env.GOOGLE_ADS_API_MOCK = 'false';
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = '346-219-8684';
  });

  afterEach(() => {
    process.env.GOOGLE_ADS_API_MOCK = 'true';
  });

  function mockCustomersMetadata(customers) {
    axios.post.mockImplementation((url, body) => {
      const query = body?.query ?? '';
      if (!query.includes('customer.id')) {
        return Promise.resolve({ status: 404, data: {} });
      }
      const customerId = String(url).match(/customers\/(\d+)/)?.[1];
      const metadata = customers.find((row) => row.id === customerId) ?? customers[0];
      return Promise.resolve({
        status: 200,
        data: {
          results: [
            {
              customer: {
                id: metadata.id,
                descriptiveName: metadata.descriptiveName,
                manager: metadata.manager,
                status: metadata.status,
                testAccount: false,
              },
            },
          ],
        },
      });
    });
  }

  async function seedConnection(overrides = {}) {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');

    const user = await User.create({ email: `ads-select-${Date.now()}@test.com` });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      businessName: 'Selection Sandbox',
    });

    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'selection_required',
      accessTokenEnc: encryptToken('ads-access'),
      refreshTokenEnc: encryptToken('ads-refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: ['https://www.googleapis.com/auth/adwords'],
      providerIdentifiers: {
        accessibleCustomerIds: ['7809414862', '2940178860', '6314301557'],
        loginCustomerId: '3462198684',
        managerCustomerId: '3462198684',
      },
      ...overrides,
    });

    return bc;
  }

  it('lists accessible customers with selectable metadata', async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: {
        resourceNames: ['customers/7809414862', 'customers/2940178860', 'customers/6314301557'],
      },
    });
    mockCustomersMetadata([
      { id: '7809414862', descriptiveName: 'Client', manager: false, status: 'ENABLED' },
      { id: '2940178860', descriptiveName: 'Manager', manager: true, status: 'ENABLED' },
      { id: '6314301557', descriptiveName: 'Cancelled', manager: false, status: 'CANCELLED' },
    ]);

    const bc = await seedConnection();
    const result = await listGoogleAdsResourceOptions(bc.businessId);

    expect(result.selectionRequired).toBe(true);
    expect(result.options).toHaveLength(3);
    expect(result.options.find((row) => row.customerId === '2940178860')?.selectable).toBe(false);
    expect(result.options.find((row) => row.customerId === '6314301557')?.selectable).toBe(false);
    expect(result.options.find((row) => row.customerId === '7809414862')?.selectable).toBe(true);
  });

  it('persists an explicit customer selection', async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { resourceNames: ['customers/7809414862'] },
    });
    mockCustomersMetadata([
      { id: '7809414862', descriptiveName: 'Client', manager: false, status: 'ENABLED' },
    ]);

    const bc = await seedConnection();
    const saved = await saveGoogleAdsSelection(bc.businessId, { customerId: '7809414862' });

    expect(saved.selectionRequired).toBe(false);
    expect(saved.selected.customerId).toBe('7809414862');

    const conn = await mongoose.model('IntegrationConnection').findOne({
      businessId: bc.businessId,
      provider: 'google_ads',
    }).lean();
    expect(conn.connectionHealth).toBe('connected');
    expect(conn.providerIdentifiers.customerId).toBe('7809414862');
    expect(conn.providerIdentifiers.selectionSource).toBe('product_setup');
  });

  it('rejects non-selectable customer', async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { resourceNames: ['customers/2940178860'] },
    });
    mockCustomersMetadata([
      { id: '2940178860', descriptiveName: 'Manager', manager: true, status: 'ENABLED' },
    ]);

    const bc = await seedConnection();

    await expect(
      saveGoogleAdsSelection(bc.businessId, { customerId: '2940178860' })
    ).rejects.toMatchObject({ code: 'ADS_SELECTION_NOT_ALLOWED' });
  });
});
