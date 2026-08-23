'use strict';

jest.mock('axios');

const axios = require('axios');
const mongoose = require('mongoose');
const { resetProviderRateLimitsForTests } = require('../lib/providerRateLimit');
const {
  runGtmConversionSetup,
  GtmProviderPreconditionError,
} = require('../services/capabilities/gtmConversionSetupService');
const { createLogger } = require('../lib/observability/logger');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { allScopesForProvider } = require('../constants/googleOAuth');

describe('gtmConversionSetupService collision handling', () => {
  const logger = createLogger({ level: 'silent' });

  async function seedGtmRun(email, goalPrimary = 'forms') {
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
      goals: { primary: goalPrimary },
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

    const convArtifacts =
      goalPrimary === 'forms'
        ? [
            {
              externalId: '1002',
              logicalCategory: 'form',
              name: 'Form conv',
              conversionId: 'AW-1234567890',
              conversionLabel: 'form_label_mock',
            },
          ]
        : [];

    for (const row of convArtifacts) {
      await IntegrationArtifact.create({
        setupRunId: run._id,
        businessId: bc.businessId,
        provider: 'google_ads',
        artifactType: 'ads_conversion_action',
        externalId: row.externalId,
        idempotencyKey: `ads-ca-${run._id}-${row.logicalCategory}`,
        metadata: {
          logicalCategory: row.logicalCategory,
          name: row.name,
          conversionId: row.conversionId,
          conversionLabel: row.conversionLabel,
        },
      });
    }

    return { bc, run };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    resetProviderRateLimitsForTests();
    process.env.GTM_API_MOCK = 'false';
    process.env.GTM_API_ENABLED = 'true';
    axios.get.mockResolvedValue({ status: 200, data: { variable: [], trigger: [], tag: [] } });
    axios.post.mockResolvedValue({
      status: 200,
      data: { path: 'accounts/mock-account/containers/mock-container/workspaces/mock-workspace/variables/1' },
    });
    axios.put = jest.fn();
  });

  it('maps unowned workspace name collision to non-retryable GTM_CONTAINER_CONFLICT', async () => {
    const existingVar = {
      name: 'Zuggernaut Form Conversion ID',
      type: 'c',
      path: 'accounts/mock-account/containers/mock-container/workspaces/mock-workspace/variables/conflict',
      parameter: [{ key: 'value', value: 'AW-OTHER' }],
    };
    axios.get.mockResolvedValue({
      status: 200,
      data: { variable: [existingVar], trigger: [], tag: [] },
    });

    const { bc, run } = await seedGtmRun('gtm-collision-unowned@test.com', 'forms');

    await expect(
      runGtmConversionSetup({ setupRunId: run._id, businessId: bc.businessId, logger })
    ).rejects.toMatchObject({ code: 'GTM_CONTAINER_CONFLICT' });

    expect(axios.put).not.toHaveBeenCalled();
  });

  it('maps same-business owned collision to GTM_CONTAINER_CONFLICT without provider update', async () => {
    const existingPath =
      'accounts/mock-account/containers/mock-container/workspaces/mock-workspace/variables/conflict';
    const existingVar = {
      name: 'Zuggernaut Form Conversion ID',
      type: 'c',
      path: existingPath,
      parameter: [{ key: 'value', value: 'AW-OTHER' }],
    };
    axios.get.mockResolvedValue({
      status: 200,
      data: { variable: [existingVar], trigger: [], tag: [] },
    });

    const { bc, run } = await seedGtmRun('gtm-collision-owned@test.com', 'forms');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    await IntegrationArtifact.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      provider: 'gtm',
      artifactType: 'gtm_variable',
      externalId: existingPath,
      idempotencyKey: 'idem-owned-collision',
      metadata: { createdBy: 'gtm_conversion_setup_v1' },
    });

    await expect(
      runGtmConversionSetup({ setupRunId: run._id, businessId: bc.businessId, logger })
    ).rejects.toMatchObject({ code: 'GTM_CONTAINER_CONFLICT' });

    expect(axios.put).not.toHaveBeenCalled();
  });
});
