'use strict';

const mongoose = require('mongoose');
const axios = require('axios');
const {
  verifyGoogleAdsOAuthConnection,
  discoverAndPersistGoogleAdsCustomers,
  ensureGoogleAdsProvisioningApproval,
  assertGoogleAdsSetupReady,
} = require('../services/capabilities/googleAdsSetupService');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER } = require('../constants/provisioning');
const { resetProviderRateLimitsForTests } = require('../lib/providerRateLimit');

jest.mock('axios');

describe('googleAdsSetupService', () => {
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

  async function seedAdsConnection(overrides = {}) {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');

    const user = await User.create({ email: `ads-setup-${Date.now()}@test.com` });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      businessName: 'Acme Co',
    });

    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'provisioning_required',
      accessTokenEnc: encryptToken('ads-access'),
      refreshTokenEnc: encryptToken('ads-refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: ['https://www.googleapis.com/auth/adwords'],
      providerIdentifiers: { discoveryReason: 'ADS_PROVISIONING_REQUIRED' },
      ...overrides.connectionFields,
    });

    return { user, bc };
  }

  it('verifyGoogleAdsOAuthConnection reports oauth ready when tokens and scopes are valid', async () => {
    const { bc } = await seedAdsConnection();
    const status = await verifyGoogleAdsOAuthConnection(bc.businessId);
    expect(status.oauthReady).toBe(true);
    expect(status.reason).toBe('provisioning_required');
  });

  it('discoverAndPersistGoogleAdsCustomers stores accessible customer IDs', async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { resourceNames: ['customers/1234567890'] },
    });

    const { bc } = await seedAdsConnection();
    const result = await discoverAndPersistGoogleAdsCustomers({ businessId: bc.businessId });

    expect(result.outcome).toBe('selection_required');
    expect(result.customerId).toBeNull();

    const conn = await mongoose.model('IntegrationConnection').findOne({
      businessId: bc.businessId,
      provider: 'google_ads',
    }).lean();
    expect(conn.providerIdentifiers.accessibleCustomerIds).toEqual(['1234567890']);
    expect(conn.providerIdentifiers.customerId).toBeUndefined();
    expect(conn.connectionHealth).toBe('selection_required');
  });

  it('discoverAndPersistGoogleAdsCustomers surfaces structured Google API errors', async () => {
    axios.get.mockResolvedValue({
      status: 403,
      data: { error: { status: 'PERMISSION_DENIED', message: 'Developer token invalid.' } },
    });

    const { bc } = await seedAdsConnection();

    await expect(
      discoverAndPersistGoogleAdsCustomers({ businessId: bc.businessId })
    ).rejects.toMatchObject({
      code: 'GOOGLE_ADS_LIST_CUSTOMERS_FAILED',
      details: expect.objectContaining({
        googleAdsError: expect.objectContaining({ action: 'listAccessibleCustomers' }),
      }),
    });
  });

  it('ensureGoogleAdsProvisioningApproval returns ready when customer already exists', async () => {
    const { bc } = await seedAdsConnection({
      connectionFields: {
        connectionHealth: 'connected',
        providerIdentifiers: { customerId: '1234567890', accessibleCustomerIds: ['1234567890'] },
      },
    });

    const result = await ensureGoogleAdsProvisioningApproval({
      businessId: bc.businessId,
      setupRunId: new mongoose.Types.ObjectId(),
    });

    expect(result.outcome).toBe('ready');
  });

  it('assertGoogleAdsSetupReady returns persisted identifiers without calling Google Ads API', async () => {
    const { bc } = await seedAdsConnection({
      connectionFields: {
        connectionHealth: 'connected',
        providerIdentifiers: {
          customerId: '1234567890',
          accessibleCustomerIds: ['1234567890'],
        },
      },
    });

    const identifiers = await assertGoogleAdsSetupReady(bc.businessId);

    expect(identifiers.customerId).toBe('1234567890');
    expect(axios.get).not.toHaveBeenCalled();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('assertGoogleAdsSetupReady fails when customer identifiers are missing', async () => {
    const { bc } = await seedAdsConnection();

    await expect(assertGoogleAdsSetupReady(bc.businessId)).rejects.toMatchObject({
      code: 'GOOGLE_ADS_IDENTIFIERS_MISSING',
    });
  });

  it('ensureGoogleAdsProvisioningApproval creates pending request when approval missing', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const { bc } = await seedAdsConnection();
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });

    const result = await ensureGoogleAdsProvisioningApproval({
      businessId: bc.businessId,
      setupRunId: run._id,
    });

    expect(result.outcome).toBe('pending_approval');
    expect(result.provisioningRequestId).toBeTruthy();

    const request = await mongoose.model('IntegrationProvisioningRequest').findById(result.provisioningRequestId).lean();
    expect(request.status).toBe('pending_approval');
    expect(request.requestedResources).toEqual(DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER.google_ads);
  });
});
