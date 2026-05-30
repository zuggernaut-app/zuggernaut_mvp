'use strict';

const mongoose = require('mongoose');
const {
  PROVISIONING_REQUEST_STATUS,
  PROVISIONING_RESOURCE_TYPES,
} = require('../constants/enums');
const { DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER } = require('../constants/provisioning');

describe('IntegrationProvisioningRequest', () => {
  const IntegrationProvisioningRequest = () =>
    mongoose.model('IntegrationProvisioningRequest');
  const User = () => mongoose.model('User');
  const BusinessContext = () => mongoose.model('BusinessContext');

  async function createBusiness() {
    const user = await User().create({ email: `ipr-${Date.now()}@test.com` });
    const bc = await BusinessContext().create({ userId: user._id, confirmedAt: new Date() });
    return { user, businessId: bc.businessId };
  }

  it('creates a pending request with requestedResources', async () => {
    const { businessId } = await createBusiness();

    const req = await IntegrationProvisioningRequest().create({
      businessId,
      provider: 'gtm',
      requestedResources: DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER.gtm,
    });

    expect(req.status).toBe('pending_approval');
    expect(req.requestedResources).toEqual(['gtm_account', 'gtm_container', 'gtm_workspace']);
    expect(req.approvedByUserId).toBeNull();
    expect(req.approvedAt).toBeNull();
    expect(req.createdProviderIdentifiers).toBeUndefined();
  });

  it('stores approval audit fields when approved', async () => {
    const { user, businessId } = await createBusiness();

    const req = await IntegrationProvisioningRequest().create({
      businessId,
      provider: 'google_ads',
      requestedResources: DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER.google_ads,
      requestedByUserId: user._id,
    });

    const approvedAt = new Date();
    req.status = 'approved';
    req.approvedByUserId = user._id;
    req.approvedAt = approvedAt;
    await req.save();

    const loaded = await IntegrationProvisioningRequest().findById(req._id).lean();
    expect(loaded.status).toBe('approved');
    expect(String(loaded.approvedByUserId)).toBe(String(user._id));
    expect(loaded.approvedAt).toEqual(approvedAt);
    expect(String(loaded.requestedByUserId)).toBe(String(user._id));
  });

  it('persists createdProviderIdentifiers on provisioned', async () => {
    const { user, businessId } = await createBusiness();

    const identifiers = {
      accountId: '12345',
      containerId: '67890',
      workspaceId: '1',
      publicContainerId: 'GTM-XXXX',
    };

    const req = await IntegrationProvisioningRequest().create({
      businessId,
      provider: 'gtm',
      requestedResources: DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER.gtm,
      status: 'provisioned',
      approvedByUserId: user._id,
      approvedAt: new Date(),
      createdProviderIdentifiers: identifiers,
    });

    const loaded = await IntegrationProvisioningRequest().findById(req._id).lean();
    expect(loaded.createdProviderIdentifiers).toEqual(identifiers);
  });

  it('rejects invalid status values', async () => {
    const { businessId } = await createBusiness();

    await expect(
      IntegrationProvisioningRequest().create({
        businessId,
        provider: 'gtm',
        requestedResources: DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER.gtm,
        status: 'not_a_status',
      })
    ).rejects.toThrow(/validation failed/i);
  });

  it('rejects invalid requestedResources values', async () => {
    const { businessId } = await createBusiness();

    await expect(
      IntegrationProvisioningRequest().create({
        businessId,
        provider: 'gtm',
        requestedResources: ['invalid_resource'],
      })
    ).rejects.toThrow(/validation failed/i);
  });

  it('rejects empty requestedResources', async () => {
    const { businessId } = await createBusiness();

    await expect(
      IntegrationProvisioningRequest().create({
        businessId,
        provider: 'gtm',
        requestedResources: [],
      })
    ).rejects.toThrow(/requestedResources must contain at least one resource type/i);
  });

  it('blocks a second active request for the same business and provider', async () => {
    const { businessId } = await createBusiness();

    await IntegrationProvisioningRequest().create({
      businessId,
      provider: 'gtm',
      requestedResources: DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER.gtm,
      status: 'pending_approval',
    });

    await expect(
      IntegrationProvisioningRequest().create({
        businessId,
        provider: 'gtm',
        requestedResources: DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER.gtm,
        status: 'approved',
      })
    ).rejects.toThrow(/duplicate key/i);
  });

  it('allows a new request after the previous one is terminal (failed)', async () => {
    const { businessId } = await createBusiness();

    await IntegrationProvisioningRequest().create({
      businessId,
      provider: 'google_ads',
      requestedResources: DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER.google_ads,
      status: 'failed',
      errorCode: 'ADS_MCC_CREATE_DENIED',
    });

    const retry = await IntegrationProvisioningRequest().create({
      businessId,
      provider: 'google_ads',
      requestedResources: DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER.google_ads,
      status: 'pending_approval',
    });

    expect(retry.status).toBe('pending_approval');
  });

  it('allows a new request after the previous one is terminal (provisioned)', async () => {
    const { businessId } = await createBusiness();

    await IntegrationProvisioningRequest().create({
      businessId,
      provider: 'gtm',
      requestedResources: DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER.gtm,
      status: 'provisioned',
      createdProviderIdentifiers: { accountId: '1', containerId: '2', workspaceId: '3' },
    });

    const next = await IntegrationProvisioningRequest().create({
      businessId,
      provider: 'gtm',
      requestedResources: DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER.gtm,
      status: 'pending_approval',
    });

    expect(next.status).toBe('pending_approval');
  });

  it('exports all provisioning request statuses in enums', () => {
    for (const status of [
      'pending_approval',
      'approved',
      'provisioning',
      'provisioned',
      'failed',
      'cancelled',
    ]) {
      expect(PROVISIONING_REQUEST_STATUS).toContain(status);
    }
    for (const resource of ['gtm_account', 'gtm_container', 'gtm_workspace', 'google_ads_customer']) {
      expect(PROVISIONING_RESOURCE_TYPES).toContain(resource);
    }
  });
});
