'use strict';

const mongoose = require('mongoose');
const {
  runSetupRunCompensation,
  existingCompensation,
} = require('../services/compensation/setupRunCompensationService');
const { SETUP_STEP_NAMES } = require('../constants/setupWorkflow');
const { createLogger } = require('../lib/observability/logger');

describe('setupRunCompensationService', () => {
  const logger = createLogger({ level: 'silent' });

  async function seedCompensationRun() {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');

    const user = await User.create({ email: 'comp@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      websiteUrl: 'https://acme.example',
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'FAILED' });

    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      accessTokenEnc: 'x',
      refreshTokenEnc: 'y',
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      providerIdentifiers: { customerId: '1234567890' },
    });

    await IntegrationArtifact.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      provider: 'google_ads',
      artifactType: 'ads_campaign',
      externalId: 'customers/1234567890/campaigns/zug-campaign-test',
      idempotencyKey: `ads-${run._id}-campaign`,
    });

    return { bc, run };
  }

  it('pauses ads campaign on partial ads failure and is idempotent', async () => {
    const { bc, run } = await seedCompensationRun();

    const first = await runSetupRunCompensation({
      setupRunId: run._id,
      businessId: bc.businessId,
      failedStep: SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
      logger,
    });

    expect(first.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'ads_campaign_pause',
          outcome: 'paused',
        }),
      ])
    );

    const second = await runSetupRunCompensation({
      setupRunId: run._id,
      businessId: bc.businessId,
      failedStep: SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
      logger,
    });

    expect(second.appliedAt).toBe(first.appliedAt);
  });

  it('records GTM manual review guidance without deleting artifacts', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');

    const user = await User.create({ email: 'comp-gtm@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'FAILED' });

    await IntegrationArtifact.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      provider: 'gtm',
      artifactType: 'gtm_tag',
      externalId: 'accounts/a/containers/c/workspaces/w/tags/t1',
      idempotencyKey: `gtm-${run._id}-tag-call`,
    });

    const result = await runSetupRunCompensation({
      setupRunId: run._id,
      businessId: bc.businessId,
      failedStep: SETUP_STEP_NAMES.GTM_CONVERSION_SETUP,
      logger,
    });

    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'gtm_manual_review_guidance',
          outcome: 'recorded',
        }),
      ])
    );

    expect(await IntegrationArtifact.countDocuments({ setupRunId: run._id, provider: 'gtm' })).toBe(1);
  });

  it('records conversion action failure guidance without pausing when no campaign exists', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');

    const user = await User.create({ email: 'comp-ca-no-campaign@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'FAILED' });

    const result = await runSetupRunCompensation({
      setupRunId: run._id,
      businessId: bc.businessId,
      failedStep: SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS,
      logger,
    });

    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'conversion_action_failure_guidance',
          outcome: 'recorded',
        }),
      ])
    );
    expect(result.actions.some((action) => action.type === 'ads_campaign_pause')).toBe(false);
  });

  it('pauses setup-created campaign when conversion action failure follows campaign artifact', async () => {
    process.env.GOOGLE_ADS_API_MOCK = 'true';
    const { bc, run } = await seedCompensationRun();

    const result = await runSetupRunCompensation({
      setupRunId: run._id,
      businessId: bc.businessId,
      failedStep: SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS,
      logger,
    });

    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'conversion_action_failure_guidance',
          outcome: 'recorded',
        }),
        expect.objectContaining({
          type: 'ads_campaign_pause',
          outcome: 'paused',
        }),
      ])
    );
  });

  it('records GTM provisioning failure guidance', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');

    const user = await User.create({ email: 'comp-gtm-prov@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'FAILED' });

    const result = await runSetupRunCompensation({
      setupRunId: run._id,
      businessId: bc.businessId,
      failedStep: SETUP_STEP_NAMES.PROVISION_GTM_RESOURCES,
      logger,
    });

    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'gtm_provisioning_failure_guidance',
          outcome: 'recorded',
        }),
      ])
    );
  });

  it('existingCompensation reads applied compensation from meta', () => {
    const meta = {
      compensation: {
        appliedAt: '2026-01-01T00:00:00.000Z',
        failedStep: 'ads_campaign_creation',
        actions: [],
      },
    };
    expect(existingCompensation(meta)?.failedStep).toBe('ads_campaign_creation');
    expect(existingCompensation({})).toBeNull();
  });
});
