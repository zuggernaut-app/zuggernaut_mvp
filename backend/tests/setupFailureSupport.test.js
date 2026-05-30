'use strict';

const mongoose = require('mongoose');
const { recordSetupFailureSupport } = require('../activities/lib/setupFailureSupport');
const { SETUP_STEP_NAMES } = require('../constants/setupWorkflow');
const { createLogger } = require('../lib/observability/logger');

describe('setupFailureSupport', () => {
  const logger = createLogger({ level: 'silent' });

  async function seedRun() {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');

    const user = await User.create({ email: 'support@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'FAILED' });
    return { bc, run };
  }

  it('records supportState and compensation on partial failure', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const { bc, run } = await seedRun();

    await IntegrationArtifact.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      provider: 'gtm',
      artifactType: 'gtm_tag',
      externalId: 'accounts/a/containers/c/workspaces/w/tags/t1',
      idempotencyKey: `gtm-${run._id}-tag-call`,
    });

    const compensation = await recordSetupFailureSupport({
      setupRunId: run._id,
      businessId: bc.businessId,
      failedStep: SETUP_STEP_NAMES.GTM_CONVERSION_SETUP,
      errorCode: 'GTM_SETUP_FAILED',
      logger,
    });

    expect(compensation.actions.length).toBeGreaterThan(0);

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.meta?.supportState?.failedStep).toBe(SETUP_STEP_NAMES.GTM_CONVERSION_SETUP);
    expect(updated.meta?.supportState?.errorCode).toBe('GTM_SETUP_FAILED');
    expect(updated.meta?.supportState?.compensation?.appliedAt).toBeTruthy();
  });

  it('records provisioning failure guidance for GTM provisioning step', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const { bc, run } = await seedRun();

    const compensation = await recordSetupFailureSupport({
      setupRunId: run._id,
      businessId: bc.businessId,
      failedStep: SETUP_STEP_NAMES.PROVISION_GTM_RESOURCES,
      errorCode: 'GTM_PROVISIONING_FAILED',
      logger,
    });

    expect(compensation.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'gtm_provisioning_failure_guidance',
          outcome: 'recorded',
        }),
      ])
    );

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.meta?.supportState?.failedStep).toBe(SETUP_STEP_NAMES.PROVISION_GTM_RESOURCES);
  });
});
