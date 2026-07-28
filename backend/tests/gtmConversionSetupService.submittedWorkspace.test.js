'use strict';

const mongoose = require('mongoose');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { createLogger } = require('../lib/observability/logger');
const { allScopesForProvider } = require('../constants/googleOAuth');

jest.mock('../services/integrations/googleTagManagerClient', () => {
  const actual = jest.requireActual('../services/integrations/googleTagManagerClient');
  return {
    ...actual,
    createAndPublishContainerVersion: jest.fn(),
    createGtmWorkspace: jest.fn(),
    createGtmWorkspaceResource: jest.fn(),
  };
});

const {
  createAndPublishContainerVersion,
  createGtmWorkspace,
  createGtmWorkspaceResource,
  GtmApiError,
} = require('../services/integrations/googleTagManagerClient');
const actualGtmClient = jest.requireActual('../services/integrations/googleTagManagerClient');
const { runGtmConversionSetup } = require('../services/capabilities/gtmConversionSetupService');

describe('gtmConversionSetupService submitted workspace recovery', () => {
  const logger = createLogger({ level: 'silent' });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GTM_API_MOCK = 'true';
    createGtmWorkspace.mockResolvedValue({
      workspaceId: 'fresh-workspace',
      name: 'Zuggernaut setup',
      path: 'accounts/mock-account/containers/mock-container/workspaces/fresh-workspace',
    });
    createAndPublishContainerVersion
      .mockRejectedValueOnce(
        new GtmApiError(
          'GTM container version create failed (400): Workspace is already submitted.',
          'GTM_VERSION_CREATE_FAILED'
        )
      )
      .mockResolvedValue({
        publishedVersionPath:
          'accounts/mock-account/containers/mock-container/versions/mock-version',
        source: 'gtm_api_mock',
      });
    createGtmWorkspaceResource.mockImplementation((ctx) =>
      actualGtmClient.createGtmWorkspaceResource(ctx)
    );
  });

  async function seedGtmRun(email) {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');

    const user = await User.create({ email });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      websiteUrl: 'https://acme.example',
      goals: { primary: 'calls' },
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });

    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('gtm-access'),
      refreshTokenEnc: encryptToken('gtm-refresh'),
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

    await IntegrationArtifact.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      provider: 'google_ads',
      artifactType: 'ads_conversion_action',
      externalId: '1001',
      idempotencyKey: `ads-ca-${run._id}-call`,
      metadata: { logicalCategory: 'call', name: 'Call conv' },
    });

    return { bc, run };
  }

  it('rotates workspace and recreates artifacts when create_version hits submitted workspace', async () => {
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const { bc, run } = await seedGtmRun('gtm-submitted@test.com');

    const result = await runGtmConversionSetup({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(createAndPublishContainerVersion).toHaveBeenCalledTimes(2);
    expect(createGtmWorkspace).toHaveBeenCalledTimes(1);
    expect(result.summary.publishedVersion).toBeTruthy();

    const conn = await IntegrationConnection.findOne({
      businessId: bc.businessId,
      provider: 'gtm',
    }).lean();
    expect(conn.providerIdentifiers.workspaceId).toBe('fresh-workspace');

    const versionArt = await IntegrationArtifact.findOne({
      setupRunId: run._id,
      provider: 'gtm',
      artifactType: 'gtm_container',
    }).lean();
    expect(versionArt.metadata.workspaceId).toBe('fresh-workspace');
  });

  it('rotates workspace when variables create hits submitted workspace', async () => {
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { bc, run } = await seedGtmRun('gtm-submitted-vars@test.com');

    createGtmWorkspaceResource
      .mockRejectedValueOnce(
        new GtmApiError(
          'GTM variables create failed (400): Workspace is already submitted.',
          'GTM_CREATE_FAILED'
        )
      )
      .mockImplementation((ctx) => actualGtmClient.createGtmWorkspaceResource(ctx));
    createAndPublishContainerVersion.mockReset();
    createAndPublishContainerVersion.mockResolvedValue({
      publishedVersionPath:
        'accounts/mock-account/containers/mock-container/versions/mock-version',
      source: 'gtm_api_mock',
    });

    const result = await runGtmConversionSetup({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(createGtmWorkspaceResource.mock.calls.length).toBeGreaterThan(1);
    expect(createGtmWorkspace).toHaveBeenCalledTimes(1);
    expect(createAndPublishContainerVersion).toHaveBeenCalledTimes(1);
    expect(result.summary.publishedVersion).toBeTruthy();

    const conn = await IntegrationConnection.findOne({
      businessId: bc.businessId,
      provider: 'gtm',
    }).lean();
    expect(conn.providerIdentifiers.workspaceId).toBe('fresh-workspace');
  });
});
