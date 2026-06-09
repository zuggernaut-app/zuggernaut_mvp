'use strict';

const mongoose = require('mongoose');
const {
  provisionGoogleAdsCustomer,
  AdsProvisioningError,
  provisioningArtifactIdempotencyKey,
} = require('../services/capabilities/adsProvisioningService');
const { createCustomerClient } = require('../services/integrations/googleAdsAccountClient');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { createLogger } = require('../lib/observability/logger');
const { DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER } = require('../constants/provisioning');
const { resetProviderRateLimitsForTests } = require('../lib/providerRateLimit');

jest.mock('../services/integrations/googleAdsAccountClient', () => {
  const actual = jest.requireActual('../services/integrations/googleAdsAccountClient');
  return {
    ...actual,
    createCustomerClient: jest.fn(),
  };
});

jest.mock('../services/integrations/googleTokenService', () => ({
  getFreshGoogleAccessToken: jest.fn().mockResolvedValue('test-ads-token'),
}));

describe('adsProvisioningService', () => {
  const logger = createLogger({ level: 'silent' });

  beforeEach(() => {
    resetProviderRateLimitsForTests();
    jest.clearAllMocks();
    process.env.GOOGLE_ADS_API_MOCK = 'true';
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = '9999999999';
    createCustomerClient.mockResolvedValue({
      customerId: 'mock-provisioned-customer',
      resourceName: 'customers/mock-provisioned-customer',
      descriptiveName: 'Acme Ads',
      managerCustomerId: '9999999999',
      provisioningSource: 'mcc_create',
    });
  });

  async function seedApprovedProvisioning(overrides = {}) {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const IntegrationProvisioningRequest = mongoose.model('IntegrationProvisioningRequest');

    const user = await User.create({ email: `ads-prov-${Date.now()}@test.com` });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      businessName: 'Acme Co',
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });

    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'provisioning_required',
      accessTokenEnc: encryptToken('ads-access'),
      refreshTokenEnc: encryptToken('ads-refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: ['https://www.googleapis.com/auth/adwords'],
      providerIdentifiers: overrides.providerIdentifiers ?? {
        discoveryReason: 'ADS_PROVISIONING_REQUIRED',
        accessibleCustomerIds: [],
      },
    });

    const request = await IntegrationProvisioningRequest.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      requestedResources: DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER.google_ads,
      status: overrides.status ?? 'approved',
      approvedByUserId: overrides.approvedByUserId ?? user._id,
      approvedAt: overrides.approvedAt ?? new Date(),
      setupRunId: run._id,
      ...overrides.requestFields,
    });

    return { user, bc, run, request };
  }

  it('throws when provisioning approval is missing', async () => {
    const { bc, run, request } = await seedApprovedProvisioning({ status: 'pending_approval' });
    request.approvedByUserId = null;
    request.approvedAt = null;
    await request.save();

    await expect(
      provisionGoogleAdsCustomer({
        businessId: bc.businessId,
        setupRunId: run._id,
        provisioningRequestId: request._id,
        logger,
      })
    ).rejects.toMatchObject({ code: 'ADS_PROVISIONING_APPROVAL_REQUIRED' });
  });

  it('selects an existing accessible customer without MCC create', async () => {
    const { bc, run, request } = await seedApprovedProvisioning({
      providerIdentifiers: {
        accessibleCustomerIds: ['1234567890', '9876543210'],
        discoveryReason: 'ADS_PROVISIONING_REQUIRED',
      },
    });

    const result = await provisionGoogleAdsCustomer({
      businessId: bc.businessId,
      setupRunId: run._id,
      provisioningRequestId: request._id,
      logger,
    });

    expect(createCustomerClient).not.toHaveBeenCalled();
    expect(result.connectionHealth).toBe('connected');
    expect(result.providerIdentifiers.customerId).toBe('1234567890');
    expect(result.providerIdentifiers.loginCustomerId).toBe('9999999999');

    const artifact = await mongoose.model('IntegrationArtifact').findOne({
      businessId: bc.businessId,
      setupRunId: run._id,
      artifactType: 'ads_customer',
    }).lean();
    expect(artifact.externalId).toBe('1234567890');
    expect(artifact.metadata.provisioningSource).toBe('discovery_selected_customer');
  });

  it('creates a customer via MCC when none are accessible', async () => {
    const { bc, run, request } = await seedApprovedProvisioning({
      providerIdentifiers: { accessibleCustomerIds: [], discoveryReason: 'ADS_PROVISIONING_REQUIRED' },
    });

    const result = await provisionGoogleAdsCustomer({
      businessId: bc.businessId,
      setupRunId: run._id,
      provisioningRequestId: request._id,
      logger,
    });

    expect(createCustomerClient).toHaveBeenCalledTimes(1);
    expect(result.providerIdentifiers.customerId).toBe('mock-provisioned-customer');

    const conn = await mongoose.model('IntegrationConnection').findOne({ businessId: bc.businessId, provider: 'google_ads' }).lean();
    expect(conn.connectionHealth).toBe('connected');

    const updatedRequest = await mongoose.model('IntegrationProvisioningRequest').findById(request._id).lean();
    expect(updatedRequest.status).toBe('provisioned');
  });

  it('reuses artifacts on retry without duplicate create calls', async () => {
    const { bc, run, request } = await seedApprovedProvisioning({
      providerIdentifiers: { accessibleCustomerIds: [], discoveryReason: 'ADS_PROVISIONING_REQUIRED' },
    });

    await provisionGoogleAdsCustomer({
      businessId: bc.businessId,
      setupRunId: run._id,
      provisioningRequestId: request._id,
      logger,
    });

    createCustomerClient.mockClear();

    const retryRequest = await mongoose.model('IntegrationProvisioningRequest').create({
      businessId: bc.businessId,
      provider: 'google_ads',
      requestedResources: DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER.google_ads,
      status: 'approved',
      approvedByUserId: request.approvedByUserId,
      approvedAt: new Date(),
      setupRunId: run._id,
    });

    await provisionGoogleAdsCustomer({
      businessId: bc.businessId,
      setupRunId: run._id,
      provisioningRequestId: retryRequest._id,
      logger,
    });

    expect(createCustomerClient).not.toHaveBeenCalled();

    const count = await mongoose.model('IntegrationArtifact').countDocuments({
      businessId: bc.businessId,
      setupRunId: run._id,
      artifactType: 'ads_customer',
    });
    expect(count).toBe(1);
  });

  it('marks provisioning request failed on API error', async () => {
    createCustomerClient.mockRejectedValueOnce(
      Object.assign(new Error('MCC permission denied'), { code: 'ADS_MCC_PERMISSION_DENIED' })
    );
    const { bc, run, request } = await seedApprovedProvisioning();

    await expect(
      provisionGoogleAdsCustomer({
        businessId: bc.businessId,
        setupRunId: run._id,
        provisioningRequestId: request._id,
        logger,
      })
    ).rejects.toThrow('MCC permission denied');

    const updatedRequest = await mongoose.model('IntegrationProvisioningRequest').findById(request._id).lean();
    expect(updatedRequest.status).toBe('failed');
    expect(updatedRequest.errorCode).toBe('ADS_MCC_PERMISSION_DENIED');
  });

  it('uses stable idempotency keys for provisioning artifacts', () => {
    const businessId = new mongoose.Types.ObjectId();
    const setupRunId = new mongoose.Types.ObjectId();
    expect(provisioningArtifactIdempotencyKey(businessId, setupRunId)).toBe(
      `ads:customer:${businessId}:${setupRunId}`
    );
  });
});
