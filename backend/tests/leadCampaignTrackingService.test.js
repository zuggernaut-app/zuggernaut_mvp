'use strict';

const mongoose = require('mongoose');
const { SETUP_STEP_NAMES } = require('../constants/setupWorkflow');
const {
  resolveFormTrackingStatus,
  resolveCallTrackingStatus,
  isCallDurationSatisfied,
} = require('../services/capabilities/leadCampaignTrackingService');

describe('leadCampaignTrackingService', () => {
  it('marks form tracking passed only when the latest completed verification step succeeded', async () => {
    const BusinessContext = mongoose.model('BusinessContext');
    const User = mongoose.model('User');
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');

    const user = await User.create({ email: 'tracking-form@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      businessName: 'Track Co',
      websiteUrl: 'https://track.example',
      services: ['Plumbing'],
      serviceAreas: ['Austin'],
      goals: { primary: 'forms' },
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'SUCCEEDED' });

    await SetupStepExecution.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
      status: 'skipped',
      endedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const skipped = await resolveFormTrackingStatus(bc.businessId);
    expect(skipped.status).toBe('failed');

    await SetupStepExecution.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
      status: 'success',
      endedAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    const passed = await resolveFormTrackingStatus(bc.businessId);
    expect(passed.status).toBe('passed');
  });

  it('returns not_checked when no completed verification step exists', async () => {
    const BusinessContext = mongoose.model('BusinessContext');
    const User = mongoose.model('User');

    const user = await User.create({ email: 'tracking-none@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      businessName: 'No Verify Co',
      websiteUrl: 'https://noverify.example',
      services: ['Plumbing'],
      serviceAreas: ['Austin'],
      goals: { primary: 'forms' },
    });

    const status = await resolveFormTrackingStatus(bc.businessId);
    expect(status.status).toBe('not_checked');
  });

  it('marks call tracking passed when conversion duration and call asset are present', async () => {
    const BusinessContext = mongoose.model('BusinessContext');
    const User = mongoose.model('User');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');

    const user = await User.create({ email: 'tracking-call@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      businessName: 'Call Track Co',
      websiteUrl: 'https://calltrack.example',
      services: ['Plumbing'],
      serviceAreas: ['Austin'],
      goals: { primary: 'calls' },
    });

    await IntegrationArtifact.create({
      setupRunId: new mongoose.Types.ObjectId(),
      businessId: bc.businessId,
      provider: 'google_ads',
      artifactType: 'ads_conversion_action',
      externalId: '1001',
      idempotencyKey: `catalog-call-${bc.businessId}`,
      metadata: {
        logicalCategory: 'call',
        resourceName: 'customers/123/conversionActions/1001',
        phoneCallDurationSeconds: 60,
      },
    });

    await IntegrationArtifact.create({
      setupRunId: new mongoose.Types.ObjectId(),
      businessId: bc.businessId,
      provider: 'google_ads',
      artifactType: 'ads_asset_call',
      externalId: 'customers/123/assets/call1',
      idempotencyKey: `call-asset-${bc.businessId}`,
      metadata: {
        slot: 'recommended',
        conversionActionResourceName: 'customers/123/conversionActions/1001',
      },
    });

    const status = await resolveCallTrackingStatus(bc.businessId, 'recommended');
    expect(status.status).toBe('passed');
  });

  it('marks call tracking failed when call asset is missing', async () => {
    const BusinessContext = mongoose.model('BusinessContext');
    const User = mongoose.model('User');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');

    const user = await User.create({ email: 'tracking-call-missing@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      businessName: 'Missing Asset Co',
      websiteUrl: 'https://missing.example',
      services: ['Plumbing'],
      serviceAreas: ['Austin'],
      goals: { primary: 'calls' },
    });

    await IntegrationArtifact.create({
      setupRunId: new mongoose.Types.ObjectId(),
      businessId: bc.businessId,
      provider: 'google_ads',
      artifactType: 'ads_conversion_action',
      externalId: '1001',
      idempotencyKey: `catalog-call-missing-${bc.businessId}`,
      metadata: {
        logicalCategory: 'call',
        resourceName: 'customers/123/conversionActions/1001',
        phoneCallDurationSeconds: 60,
      },
    });

    const status = await resolveCallTrackingStatus(bc.businessId, 'recommended');
    expect(status.status).toBe('failed');
  });

  it('evaluates call duration threshold via phoneCallDurationSeconds', () => {
    expect(isCallDurationSatisfied({ phoneCallDurationSeconds: 60 })).toBe(true);
    expect(isCallDurationSatisfied({ phoneCallDurationSeconds: 30 })).toBe(false);
    expect(isCallDurationSatisfied({})).toBe(false);
  });
});
