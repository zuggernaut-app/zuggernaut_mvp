'use strict';

const mongoose = require('mongoose');
const {
  provisionGtmResources,
  GtmProvisioningError,
  provisioningArtifactIdempotencyKey,
} = require('../services/capabilities/gtmProvisioningService');
const {
  createGtmAccount,
  createGtmContainer,
  resolveOrCreateWorkspace,
} = require('../services/integrations/googleTagManagerClient');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { createLogger } = require('../lib/observability/logger');
const { allScopesForProvider } = require('../constants/googleOAuth');
const { DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER } = require('../constants/provisioning');
const { resetProviderRateLimitsForTests } = require('../lib/providerRateLimit');

jest.mock('../services/integrations/googleTagManagerClient', () => {
  const actual = jest.requireActual('../services/integrations/googleTagManagerClient');
  return {
    ...actual,
    createGtmAccount: jest.fn(),
    createGtmContainer: jest.fn(),
    resolveOrCreateWorkspace: jest.fn(),
    getGtmAccessToken: jest.fn(),
  };
});

describe('gtmProvisioningService', () => {
  const logger = createLogger({ level: 'silent' });

  beforeEach(() => {
    resetProviderRateLimitsForTests();
    jest.clearAllMocks();
    process.env.GTM_API_MOCK = 'true';
    require('../services/integrations/googleTagManagerClient').getGtmAccessToken.mockResolvedValue('test-token');
    createGtmAccount.mockResolvedValue({
      accountId: 'prov-account-1',
      name: 'Zuggernaut GTM',
      path: 'accounts/prov-account-1',
    });
    createGtmContainer.mockResolvedValue({
      containerId: 'prov-container-1',
      publicContainerId: 'GTM-PROV1',
      name: 'Zuggernaut Web',
      usageContext: ['web'],
      path: 'accounts/prov-account-1/containers/prov-container-1',
    });
    resolveOrCreateWorkspace.mockResolvedValue({
      workspaceId: 'prov-workspace-1',
      name: 'Default Workspace',
      path: 'accounts/prov-account-1/containers/prov-container-1/workspaces/prov-workspace-1',
    });
  });

  async function seedApprovedProvisioning(overrides = {}) {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const IntegrationProvisioningRequest = mongoose.model('IntegrationProvisioningRequest');

    const user = await User.create({ email: `gtm-prov-${Date.now()}@test.com` });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });

    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'gtm',
      connectionHealth: 'provisioning_required',
      accessTokenEnc: encryptToken('gtm-access'),
      refreshTokenEnc: encryptToken('gtm-refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: allScopesForProvider('gtm'),
      providerIdentifiers: { discoveryReason: 'GTM_PROVISIONING_REQUIRED' },
    });

    const request = await IntegrationProvisioningRequest.create({
      businessId: bc.businessId,
      provider: 'gtm',
      requestedResources: DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER.gtm,
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
      provisionGtmResources({
        businessId: bc.businessId,
        setupRunId: run._id,
        provisioningRequestId: request._id,
        logger,
      })
    ).rejects.toMatchObject({ code: 'GTM_PROVISIONING_APPROVAL_REQUIRED' });
  });

  it('creates account/container/workspace artifacts and persists identifiers', async () => {
    const { bc, run, request } = await seedApprovedProvisioning();

    const result = await provisionGtmResources({
      businessId: bc.businessId,
      setupRunId: run._id,
      provisioningRequestId: request._id,
      logger,
    });

    expect(result.connectionHealth).toBe('connected');
    expect(result.providerIdentifiers).toEqual({
      accountId: 'prov-account-1',
      containerId: 'prov-container-1',
      workspaceId: 'prov-workspace-1',
      publicContainerId: 'GTM-PROV1',
    });

    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const artifacts = await IntegrationArtifact.find({ businessId: bc.businessId, setupRunId: run._id }).lean();
    expect(artifacts).toHaveLength(3);
    expect(artifacts.map((a) => a.artifactType).sort()).toEqual([
      'gtm_account',
      'gtm_container',
      'gtm_workspace',
    ]);

    const conn = await mongoose.model('IntegrationConnection').findOne({ businessId: bc.businessId, provider: 'gtm' }).lean();
    expect(conn.connectionHealth).toBe('connected');
    expect(conn.providerIdentifiers.accountId).toBe('prov-account-1');

    const updatedRequest = await mongoose.model('IntegrationProvisioningRequest').findById(request._id).lean();
    expect(updatedRequest.status).toBe('provisioned');
    expect(updatedRequest.createdProviderIdentifiers.workspaceId).toBe('prov-workspace-1');
  });

  it('reuses artifacts on retry without duplicate create calls', async () => {
    const { bc, run, request } = await seedApprovedProvisioning();

    await provisionGtmResources({
      businessId: bc.businessId,
      setupRunId: run._id,
      provisioningRequestId: request._id,
      logger,
    });

    createGtmAccount.mockClear();
    createGtmContainer.mockClear();
    resolveOrCreateWorkspace.mockClear();

    const retryRequest = await mongoose.model('IntegrationProvisioningRequest').create({
      businessId: bc.businessId,
      provider: 'gtm',
      requestedResources: DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER.gtm,
      status: 'approved',
      approvedByUserId: request.approvedByUserId,
      approvedAt: new Date(),
      setupRunId: run._id,
    });

    await provisionGtmResources({
      businessId: bc.businessId,
      setupRunId: run._id,
      provisioningRequestId: retryRequest._id,
      logger,
    });

    expect(createGtmAccount).not.toHaveBeenCalled();
    expect(createGtmContainer).not.toHaveBeenCalled();
    expect(resolveOrCreateWorkspace).not.toHaveBeenCalled();

    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const count = await IntegrationArtifact.countDocuments({ businessId: bc.businessId, setupRunId: run._id });
    expect(count).toBe(3);
  });

  it('marks provisioning request failed on API error', async () => {
    const { bc, run, request } = await seedApprovedProvisioning();
    createGtmAccount.mockRejectedValueOnce(Object.assign(new Error('GTM account denied'), { code: 'GTM_CREATE_FAILED' }));

    await expect(
      provisionGtmResources({
        businessId: bc.businessId,
        setupRunId: run._id,
        provisioningRequestId: request._id,
        logger,
      })
    ).rejects.toThrow('GTM account denied');

    const updatedRequest = await mongoose.model('IntegrationProvisioningRequest').findById(request._id).lean();
    expect(updatedRequest.status).toBe('failed');
    expect(updatedRequest.errorCode).toBe('GTM_CREATE_FAILED');
  });

  it('uses stable idempotency keys for provisioning artifacts', () => {
    const businessId = new mongoose.Types.ObjectId();
    const setupRunId = new mongoose.Types.ObjectId();
    expect(provisioningArtifactIdempotencyKey(businessId, setupRunId, 'account')).toBe(
      `gtm:account:${businessId}:${setupRunId}`
    );
  });
});
