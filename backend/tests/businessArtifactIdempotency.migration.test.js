'use strict';

const mongoose = require('mongoose');
const { createLogger } = require('../lib/observability/logger');
const { businessScopedIdempotencyKey } = require('../constants/idempotency');
const { computeBusinessIntentFingerprint } = require('../lib/idempotency/businessIntentFingerprint');
const { migrateLegacyArtifactIdempotencyKeys } = require('../lib/idempotency/migrateBusinessArtifactKeys');
const { createAdsAutoCampaign } = require('../services/capabilities/adsAutoCampaignService');
const googleAdsCampaignClient = require('../services/integrations/googleAdsCampaignClient');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { SETUP_STEP_NAMES } = require('../constants/setupWorkflow');

describe('business artifact idempotency migration', () => {
  const logger = createLogger({ level: 'silent' });
  const BusinessContext = mongoose.model('BusinessContext');
  const IntegrationArtifact = mongoose.model('IntegrationArtifact');
  const User = mongoose.model('User');
  const SetupRun = mongoose.model('SetupRun');
  const SetupStepExecution = mongoose.model('SetupStepExecution');
  const IntegrationConnection = mongoose.model('IntegrationConnection');

  async function seedRunnableSetup(businessId, emailSuffix) {
    await User.create({ email: `biz-idem-run-${emailSuffix}@example.com` });
    const run = await SetupRun.create({ businessId, status: 'RUNNING' });
    const existingConn = await IntegrationConnection.findOne({ businessId, provider: 'google_ads' }).lean();
    if (!existingConn) {
      await IntegrationConnection.create({
        businessId,
        provider: 'google_ads',
        connectionHealth: 'connected',
        accessTokenEnc: encryptToken('ads-access'),
        refreshTokenEnc: encryptToken('ads-refresh'),
        tokenExpiryAt: new Date(Date.now() + 3600_000),
        scopes: ['https://www.googleapis.com/auth/adwords'],
        providerIdentifiers: { customerId: '1234567890' },
      });
    }
    await SetupStepExecution.create({
      setupRunId: run._id,
      businessId,
      stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
      status: 'success',
      provider: 'gtm',
    });
    await IntegrationArtifact.create({
      businessId,
      setupRunId: run._id,
      provider: 'google_ads',
      artifactType: 'ads_conversion_action',
      externalId: '1001',
      idempotencyKey: `ads-ca-${run._id}-call`,
      metadata: { logicalCategory: 'call', name: 'Call conv' },
    });
    return run;
  }

  it('migrates legacy keys and reuses without duplicate external create on second run', async () => {
    const user = await User.create({ email: 'biz-idem@example.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      businessName: 'Stable Biz',
      websiteUrl: 'https://stable.example',
      industry: 'plumbing',
      services: ['Drain cleaning'],
      goals: { primary: 'calls' },
      serviceAreas: ['Austin'],
      confirmedAt: new Date(),
    });
    const businessId = bc.businessId;
    const setupRunId1 = new mongoose.Types.ObjectId();
    const fingerprint = computeBusinessIntentFingerprint(bc);

    await IntegrationArtifact.create({
      businessId,
      setupRunId: setupRunId1,
      provider: 'google_ads',
      artifactType: 'ads_campaign',
      externalId: 'customers/1/campaigns/99',
      idempotencyKey: `ads-${setupRunId1.toString()}-campaign`,
      metadata: { logicalKey: 'campaign' },
    });

    const result = await migrateLegacyArtifactIdempotencyKeys();
    expect(result.migrated).toBe(1);

    const migrated = await IntegrationArtifact.findOne({
      businessId,
      externalId: 'customers/1/campaigns/99',
    }).lean();
    expect(migrated.idempotencyKey).toBe(
      businessScopedIdempotencyKey(businessId, 'google_ads', 'campaign', fingerprint)
    );

    const { findReusableArtifact } = require('../constants/idempotency');
    const reused = await findReusableArtifact({
      businessId,
      provider: 'google_ads',
      logicalKey: 'campaign',
      fingerprint,
    });
    expect(reused?.externalId).toBe('customers/1/campaigns/99');

    const run2 = await seedRunnableSetup(businessId, 'post-migrate');
    const createCampaignSpy = jest.spyOn(googleAdsCampaignClient, 'createCampaign');

    const first = await createAdsAutoCampaign({
      setupRunId: run2._id,
      businessId,
      logger,
    });
    expect(first.summary.reusedArtifacts).toBeGreaterThan(0);
    expect(createCampaignSpy).not.toHaveBeenCalled();

    const campaignArtifacts = await IntegrationArtifact.countDocuments({
      businessId,
      provider: 'google_ads',
      artifactType: 'ads_campaign',
    });
    expect(campaignArtifacts).toBe(1);

    const run3 = await seedRunnableSetup(businessId, 'post-migrate-2');
    createCampaignSpy.mockClear();

    const second = await createAdsAutoCampaign({
      setupRunId: run3._id,
      businessId,
      logger,
    });
    expect(second.summary.reusedArtifacts).toBeGreaterThan(0);
    expect(createCampaignSpy).not.toHaveBeenCalled();
    expect(
      await IntegrationArtifact.countDocuments({
        businessId,
        provider: 'google_ads',
        artifactType: 'ads_campaign',
      })
    ).toBe(1);

    createCampaignSpy.mockRestore();
  });
});
