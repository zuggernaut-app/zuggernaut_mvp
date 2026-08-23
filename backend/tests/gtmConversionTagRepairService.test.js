'use strict';

const mongoose = require('mongoose');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { allScopesForProvider } = require('../constants/googleOAuth');
const { createLogger } = require('../lib/observability/logger');

jest.mock('../services/integrations/googleTagManagerClient', () => ({
  createGtmWorkspace: jest.fn(),
  createGtmWorkspaceResource: jest.fn(),
  listGtmWorkspaceResources: jest.fn(),
  updateGtmWorkspaceResource: jest.fn(),
  createGtmContainerVersion: jest.fn(),
  publishGtmContainerVersion: jest.fn(),
  enableGtmBuiltinVariables: jest.fn(),
  getGtmAccessToken: jest.fn(),
  fetchGtmLiveContainerVersionPath: jest.fn(),
}));

const gtmClient = require('../services/integrations/googleTagManagerClient');
const {
  collectRepairBusinessIds,
  repairGtmConversionTagsForBusiness,
} = require('../services/capabilities/gtmConversionTagRepairService');

describe('gtmConversionTagRepairService', () => {
  const logger = createLogger({ level: 'silent' });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GTM_API_MOCK = 'true';
    process.env.GTM_API_ENABLED = 'true';

    gtmClient.getGtmAccessToken.mockResolvedValue('gtm-access-token');
    gtmClient.fetchGtmLiveContainerVersionPath.mockResolvedValue({
      path: 'accounts/mock-account/containers/mock-container/versions/mock-live',
      containerVersionId: 'mock-live',
      source: 'gtm_api_mock',
    });
    gtmClient.createGtmWorkspace.mockResolvedValue({
      workspaceId: 'repair-workspace',
      path: 'accounts/mock-account/containers/mock-container/workspaces/repair-workspace',
    });
    gtmClient.listGtmWorkspaceResources.mockResolvedValue([]);
    gtmClient.createGtmWorkspaceResource.mockImplementation(async ({ collection, logicalKey }) => ({
      resourcePath: `accounts/mock-account/containers/mock-container/workspaces/repair-workspace/${collection}/${logicalKey}`,
      source: 'gtm_api_mock',
    }));
    gtmClient.updateGtmWorkspaceResource.mockImplementation(async ({ existing }) => ({
      resourcePath: existing.path,
      source: 'gtm_api_mock',
    }));
    gtmClient.enableGtmBuiltinVariables.mockResolvedValue({ enabled: true });
    gtmClient.createGtmContainerVersion.mockResolvedValue({
      versionPath: 'accounts/mock-account/containers/mock-container/versions/mock-repair',
      containerVersionId: 'mock-repair',
      source: 'gtm_api_mock',
    });
    gtmClient.publishGtmContainerVersion.mockResolvedValue({
      publishedVersionPath:
        'accounts/mock-account/containers/mock-container/versions/mock-repair-published',
      source: 'gtm_api_mock',
    });
  });

  async function seedRepairBusiness() {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');

    const user = await User.create({ email: `repair-${Date.now()}@test.com` });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      websiteUrl: 'https://acme.example',
      goals: { primary: 'both' },
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'SUCCEEDED' });

    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('ads-access'),
      refreshTokenEnc: encryptToken('ads-refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: ['https://www.googleapis.com/auth/adwords'],
      providerIdentifiers: { customerId: '1234567890' },
    });

    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'gtm',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('gtm-access'),
      refreshTokenEnc: encryptToken('gtm-refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: allScopesForProvider('gtm'),
      providerIdentifiers: {
        accountId: 'mock-account',
        containerId: 'mock-container',
        workspaceId: 'mock-workspace',
        publicContainerId: 'GTM-MOCK',
      },
    });

    for (const row of [
      {
        externalId: '1001',
        logicalCategory: 'call',
        conversionId: 'AW-1234567890',
        conversionLabel: 'call_label_mock',
      },
      {
        externalId: '1002',
        logicalCategory: 'form',
        conversionId: 'AW-1234567890',
        conversionLabel: 'form_label_mock',
      },
    ]) {
      await IntegrationArtifact.create({
        setupRunId: run._id,
        businessId: bc.businessId,
        provider: 'google_ads',
        artifactType: 'ads_conversion_action',
        externalId: row.externalId,
        idempotencyKey: `ads-ca-${run._id}-${row.logicalCategory}`,
        metadata: {
          logicalCategory: row.logicalCategory,
          conversionId: row.conversionId,
          conversionLabel: row.conversionLabel,
        },
      });
    }

    return { bc, run };
  }

  it('collectRepairBusinessIds returns unique business ids', () => {
    expect(
      collectRepairBusinessIds([
        { businessId: 'a', source: 'artifact' },
        { businessId: 'b', source: 'published_container' },
        { businessId: 'a', source: 'published_container' },
      ])
    ).toEqual(['a', 'b']);
  });

  it('repairs via new workspace, version create, and publish with rollback path', async () => {
    const { bc } = await seedRepairBusiness();

    const result = await repairGtmConversionTagsForBusiness({
      businessId: bc.businessId,
      logger,
    });

    expect(gtmClient.fetchGtmLiveContainerVersionPath).toHaveBeenCalledWith(
      'gtm-access-token',
      'mock-account',
      'mock-container'
    );
    expect(gtmClient.createGtmWorkspace).toHaveBeenCalled();
    expect(gtmClient.createGtmWorkspaceResource).toHaveBeenCalled();
    expect(gtmClient.enableGtmBuiltinVariables).toHaveBeenCalled();
    expect(gtmClient.createGtmContainerVersion).toHaveBeenCalled();
    expect(gtmClient.publishGtmContainerVersion).toHaveBeenCalled();

    const createVersionOrder = gtmClient.createGtmContainerVersion.mock.invocationCallOrder[0];
    const publishOrder = gtmClient.publishGtmContainerVersion.mock.invocationCallOrder[0];
    expect(createVersionOrder).toBeLessThan(publishOrder);

    expect(result).toMatchObject({
      businessId: String(bc.businessId),
      rollbackVersionPath:
        'accounts/mock-account/containers/mock-container/versions/mock-live',
      publishedVersionPath:
        'accounts/mock-account/containers/mock-container/versions/mock-repair-published',
      workspaceId: 'repair-workspace',
    });
  });

  it('updates inherited wrong awct tags instead of reusing them', async () => {
    const { bc } = await seedRepairBusiness();

    gtmClient.listGtmWorkspaceResources.mockImplementation(async (_token, _gtmIds, collection) => {
      if (collection === 'variables') {
        return [
          {
            name: 'Zuggernaut Form Conversion ID',
            type: 'c',
            path: 'accounts/mock-account/containers/mock-container/workspaces/repair-workspace/variables/form-id',
            parameter: [{ key: 'value', value: '1234567890' }],
          },
          {
            name: 'Zuggernaut Form Conversion Label',
            type: 'c',
            path: 'accounts/mock-account/containers/mock-container/workspaces/repair-workspace/variables/form-label',
            parameter: [{ key: 'value', value: '1002' }],
          },
          {
            name: 'Zuggernaut Call Conversion ID',
            type: 'c',
            path: 'accounts/mock-account/containers/mock-container/workspaces/repair-workspace/variables/call-id',
            parameter: [{ key: 'value', value: '1234567890' }],
          },
          {
            name: 'Zuggernaut Call Conversion Label',
            type: 'c',
            path: 'accounts/mock-account/containers/mock-container/workspaces/repair-workspace/variables/call-label',
            parameter: [{ key: 'value', value: '1001' }],
          },
        ];
      }
      if (collection === 'triggers') {
        return [
          {
            name: 'Zuggernaut Form Confirmation Page',
            type: 'pageview',
            path: 'accounts/mock-account/containers/mock-container/workspaces/repair-workspace/triggers/10',
            triggerId: '10',
          },
          {
            name: 'Zuggernaut Form Submit',
            type: 'formSubmission',
            path: 'accounts/mock-account/containers/mock-container/workspaces/repair-workspace/triggers/11',
            triggerId: '11',
          },
          {
            name: 'Zuggernaut Call Tel Click',
            type: 'linkClick',
            path: 'accounts/mock-account/containers/mock-container/workspaces/repair-workspace/triggers/12',
            triggerId: '12',
          },
        ];
      }
      if (collection === 'tags') {
        return [
          {
            name: 'Zuggernaut Form Conversion',
            type: 'awct',
            path: 'accounts/mock-account/containers/mock-container/workspaces/repair-workspace/tags/21',
            tagId: '21',
            parameter: [
              { key: 'conversionId', value: '{{Zuggernaut Ads Customer ID}}' },
              { key: 'conversionLabel', value: '1002' },
            ],
          },
          {
            name: 'Zuggernaut Call Conversion',
            type: 'awct',
            path: 'accounts/mock-account/containers/mock-container/workspaces/repair-workspace/tags/22',
            tagId: '22',
            parameter: [
              { key: 'conversionId', value: '{{Zuggernaut Ads Customer ID}}' },
              { key: 'conversionLabel', value: '1001' },
            ],
          },
        ];
      }
      return [];
    });

    await repairGtmConversionTagsForBusiness({
      businessId: bc.businessId,
      logger,
    });

    expect(gtmClient.updateGtmWorkspaceResource).toHaveBeenCalled();
    const tagUpdates = gtmClient.updateGtmWorkspaceResource.mock.calls.filter(
      ([ctx]) => ctx.collection === 'tags'
    );
    expect(tagUpdates.length).toBe(2);
    expect(tagUpdates[0][0].payload.parameter).toEqual(
      expect.arrayContaining([
        { type: 'template', key: 'conversionId', value: '{{Zuggernaut Form Conversion ID}}' },
        { type: 'template', key: 'conversionLabel', value: '{{Zuggernaut Form Conversion Label}}' },
      ])
    );
    expect(
      gtmClient.createGtmWorkspaceResource.mock.calls.filter(([ctx]) => ctx.collection === 'tags')
    ).toHaveLength(0);
  });

  it('rewrites gtm_tag artifact parameters after successful repair', async () => {
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const { bc, run } = await seedRepairBusiness();

    await IntegrationArtifact.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      provider: 'gtm',
      artifactType: 'gtm_tag',
      externalId: 'accounts/mock/tags/21',
      idempotencyKey: `gtm-tag-form-${run._id}`,
      metadata: {
        template: 'ads_conversion_form',
        gtmPayload: {
          parameter: [
            { key: 'conversionId', value: '{{Zuggernaut Ads Customer ID}}' },
            { key: 'conversionLabel', value: '1002' },
          ],
        },
      },
    });

    await repairGtmConversionTagsForBusiness({
      businessId: bc.businessId,
      logger,
    });

    const updated = await IntegrationArtifact.findOne({
      businessId: bc.businessId,
      artifactType: 'gtm_tag',
      'metadata.template': 'ads_conversion_form',
    }).lean();

    expect(updated.metadata.gtmPayload.parameter).toEqual(
      expect.arrayContaining([
        { type: 'template', key: 'conversionId', value: '{{Zuggernaut Form Conversion ID}}' },
        { type: 'template', key: 'conversionLabel', value: '{{Zuggernaut Form Conversion Label}}' },
      ])
    );
  });

  it('does not publish when workspace update fails', async () => {
    const { bc } = await seedRepairBusiness();

    gtmClient.listGtmWorkspaceResources.mockImplementation(async (_token, _gtmIds, collection) => {
      if (collection === 'tags') {
        return [
          {
            name: 'Zuggernaut Form Conversion',
            type: 'awct',
            path: 'accounts/mock-account/containers/mock-container/workspaces/repair-workspace/tags/21',
            tagId: '21',
            parameter: [
              { key: 'conversionId', value: '{{Zuggernaut Ads Customer ID}}' },
              { key: 'conversionLabel', value: '1002' },
            ],
          },
        ];
      }
      if (collection === 'triggers') {
        return [
          {
            name: 'Zuggernaut Form Confirmation Page',
            type: 'pageview',
            path: 'accounts/mock-account/containers/mock-container/workspaces/repair-workspace/triggers/10',
            triggerId: '10',
          },
          {
            name: 'Zuggernaut Form Submit',
            type: 'formSubmission',
            path: 'accounts/mock-account/containers/mock-container/workspaces/repair-workspace/triggers/11',
            triggerId: '11',
          },
        ];
      }
      return [];
    });
    gtmClient.updateGtmWorkspaceResource.mockRejectedValueOnce(
      new Error('GTM tags update failed (400)')
    );

    await expect(
      repairGtmConversionTagsForBusiness({
        businessId: bc.businessId,
        logger,
      })
    ).rejects.toThrow('GTM tags update failed (400)');

    expect(gtmClient.createGtmContainerVersion).not.toHaveBeenCalled();
    expect(gtmClient.publishGtmContainerVersion).not.toHaveBeenCalled();
  });
});
