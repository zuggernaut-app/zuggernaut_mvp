'use strict';

const mongoose = require('mongoose');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { allScopesForProvider } = require('../constants/googleOAuth');
const { DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER } = require('../constants/provisioning');
const {
  getProvisioningOverview,
  createProvisioningRequest,
  approveProvisioningRequest,
  executeProvisioningRequest,
  cancelProvisioningRequest,
  ensureSetupProvisioningRequest,
  checkSetupProvisioningApproval,
  ProvisioningServiceError,
} = require('../services/capabilities/integrationProvisioningService');

async function seedProvisioningRequiredConnection(businessId, provider) {
  const IntegrationConnection = mongoose.model('IntegrationConnection');
  const scopes =
    provider === 'gtm'
      ? allScopesForProvider('gtm')
      : ['https://www.googleapis.com/auth/adwords'];

  await IntegrationConnection.create({
    businessId,
    provider,
    connectionHealth: 'provisioning_required',
    accessTokenEnc: encryptToken('token'),
    refreshTokenEnc: encryptToken('refresh'),
    tokenExpiryAt: new Date(Date.now() + 3600_000),
    scopes,
    providerIdentifiers: {
      discoveryReason:
        provider === 'gtm' ? 'GTM_PROVISIONING_REQUIRED' : 'ADS_PROVISIONING_REQUIRED',
    },
  });
}

describe('integrationProvisioningService', () => {
  async function createBusiness(email = `ips-${Date.now()}@test.com`) {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const user = await User.create({ email });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    return { user, businessId: bc.businessId };
  }

  it('returns provisioning overview for gtm and google_ads', async () => {
    const { businessId } = await createBusiness();
    await seedProvisioningRequiredConnection(businessId, 'gtm');

    const overview = await getProvisioningOverview(businessId);
    expect(overview.businessId).toBe(businessId.toString());
    expect(overview.providers.gtm.provisioningRequired).toBe(true);
    expect(overview.providers.gtm.activeRequest).toBeNull();
    expect(overview.providers.google_ads.connection.ready).toBe(false);
  });

  it('creates a pending provisioning request when provider needs resources', async () => {
    const { user, businessId } = await createBusiness();
    await seedProvisioningRequiredConnection(businessId, 'google_ads');

    const { request, created } = await createProvisioningRequest({
      businessId,
      provider: 'google_ads',
      requestedByUserId: user._id,
    });

    expect(created).toBe(true);
    expect(request.status).toBe('pending_approval');
    expect(request.requestedResources).toEqual(DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER.google_ads);
  });

  it('returns existing active request idempotently', async () => {
    const { user, businessId } = await createBusiness();
    await seedProvisioningRequiredConnection(businessId, 'gtm');

    const first = await createProvisioningRequest({
      businessId,
      provider: 'gtm',
      requestedByUserId: user._id,
    });
    const second = await createProvisioningRequest({
      businessId,
      provider: 'gtm',
      requestedByUserId: user._id,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.request.id).toBe(first.request.id);
  });

  it('rejects create when provider is already setup-ready', async () => {
    const { user, businessId } = await createBusiness();
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    await IntegrationConnection.create({
      businessId,
      provider: 'gtm',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: allScopesForProvider('gtm'),
      providerIdentifiers: {
        accountId: 'acc-1',
        containerId: 'cont-1',
        workspaceId: 'ws-1',
      },
    });

    await expect(
      createProvisioningRequest({
        businessId,
        provider: 'gtm',
        requestedByUserId: user._id,
      })
    ).rejects.toMatchObject({ code: 'PROVISIONING_NOT_REQUIRED' });
  });

  it('rejects create when provider is not connected', async () => {
    const { user, businessId } = await createBusiness();

    await expect(
      createProvisioningRequest({
        businessId,
        provider: 'gtm',
        requestedByUserId: user._id,
      })
    ).rejects.toMatchObject({ code: 'PROVISIONING_CONNECTION_REQUIRED' });
  });

  it('approves a pending request with audit fields', async () => {
    const { user, businessId } = await createBusiness();
    await seedProvisioningRequiredConnection(businessId, 'gtm');

    const { request } = await createProvisioningRequest({
      businessId,
      provider: 'gtm',
      requestedByUserId: user._id,
    });

    const approved = await approveProvisioningRequest({
      requestId: request.id,
      businessId,
      approvedByUserId: user._id,
    });

    expect(approved.status).toBe('approved');
    expect(approved.approvedAt).toBeTruthy();
  });

  it('cancels a pending request', async () => {
    const { user, businessId } = await createBusiness();
    await seedProvisioningRequiredConnection(businessId, 'google_ads');

    const { request } = await createProvisioningRequest({
      businessId,
      provider: 'google_ads',
      requestedByUserId: user._id,
    });

    const cancelled = await cancelProvisioningRequest({
      requestId: request.id,
      businessId,
    });

    expect(cancelled.status).toBe('cancelled');
  });

  it('executes approved GTM provisioning and marks connection setup-ready', async () => {
    const { user, businessId } = await createBusiness();
    await seedProvisioningRequiredConnection(businessId, 'gtm');
    const run = await mongoose.model('SetupRun').create({ businessId, status: 'RUNNING' });

    const { request } = await createProvisioningRequest({
      businessId,
      provider: 'gtm',
      requestedByUserId: user._id,
      setupRunId: run._id,
    });
    await approveProvisioningRequest({
      requestId: request.id,
      businessId,
      approvedByUserId: user._id,
    });

    const result = await executeProvisioningRequest({
      requestId: request.id,
      businessId,
      setupRunId: run._id,
    });

    expect(result.providerIdentifiers.accountId).toBeTruthy();
    expect(result.connectionHealth).toBe('connected');

    const conn = await mongoose.model('IntegrationConnection').findOne({ businessId, provider: 'gtm' }).lean();
    expect(conn.providerIdentifiers.accountId).toBeTruthy();
    expect(conn.connectionHealth).toBe('connected');

    const updatedRequest = await mongoose
      .model('IntegrationProvisioningRequest')
      .findById(request.id)
      .lean();
    expect(updatedRequest.status).toBe('provisioned');
  });

  it('ensureSetupProvisioningRequest links setupRunId idempotently', async () => {
    const { businessId } = await createBusiness();
    await seedProvisioningRequiredConnection(businessId, 'gtm');
    const run = await mongoose.model('SetupRun').create({ businessId, status: 'RUNNING' });

    const first = await ensureSetupProvisioningRequest({
      businessId,
      provider: 'gtm',
      setupRunId: run._id,
    });
    const second = await ensureSetupProvisioningRequest({
      businessId,
      provider: 'gtm',
      setupRunId: run._id,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.request.id).toBe(first.request.id);
    expect(second.request.setupRunId).toBe(run._id.toString());
  });

  it('checkSetupProvisioningApproval returns pending_approval for active request', async () => {
    const { user, businessId } = await createBusiness();
    await seedProvisioningRequiredConnection(businessId, 'google_ads');
    const { request } = await createProvisioningRequest({
      businessId,
      provider: 'google_ads',
      requestedByUserId: user._id,
    });

    const check = await checkSetupProvisioningApproval({ businessId, provider: 'google_ads' });
    expect(check.outcome).toBe('pending_approval');
    expect(check.provisioningRequestId).toBe(request.id);
  });

  it('checkSetupProvisioningApproval returns approved after consent', async () => {
    const { user, businessId } = await createBusiness();
    await seedProvisioningRequiredConnection(businessId, 'gtm');
    const { request } = await createProvisioningRequest({
      businessId,
      provider: 'gtm',
      requestedByUserId: user._id,
    });
    await approveProvisioningRequest({
      requestId: request.id,
      businessId,
      approvedByUserId: user._id,
    });

    const check = await checkSetupProvisioningApproval({ businessId, provider: 'gtm' });
    expect(check.outcome).toBe('approved');
    expect(check.provisioningRequestId).toBe(request.id);
  });

  it('checkSetupProvisioningApproval returns terminal_failure for cancelled request', async () => {
    const { user, businessId } = await createBusiness();
    await seedProvisioningRequiredConnection(businessId, 'gtm');
    const { request } = await createProvisioningRequest({
      businessId,
      provider: 'gtm',
      requestedByUserId: user._id,
    });
    await cancelProvisioningRequest({
      requestId: request.id,
      businessId,
    });

    const check = await checkSetupProvisioningApproval({ businessId, provider: 'gtm' });
    expect(check.outcome).toBe('terminal_failure');
    expect(check.request.status).toBe('cancelled');
  });

  it('throws when executing without approval', async () => {
    const { user, businessId } = await createBusiness();
    await seedProvisioningRequiredConnection(businessId, 'google_ads');
    const run = await mongoose.model('SetupRun').create({ businessId, status: 'RUNNING' });

    const { request } = await createProvisioningRequest({
      businessId,
      provider: 'google_ads',
      requestedByUserId: user._id,
    });

    await expect(
      executeProvisioningRequest({
        requestId: request.id,
        businessId,
        setupRunId: run._id,
      })
    ).rejects.toMatchObject({ code: 'PROVISIONING_APPROVAL_REQUIRED' });
  });

  it('rejects unsupported provider', async () => {
    const { user, businessId } = await createBusiness();

    await expect(
      createProvisioningRequest({
        businessId,
        provider: 'gbp',
        requestedByUserId: user._id,
      })
    ).rejects.toBeInstanceOf(ProvisioningServiceError);
  });
});
