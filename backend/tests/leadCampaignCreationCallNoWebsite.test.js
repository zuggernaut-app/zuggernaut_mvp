'use strict';

const mongoose = require('mongoose');
const { createLeadCampaignsForSetupRun } = require('../services/capabilities/leadCampaignCreationService');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { SETUP_STEP_NAMES } = require('../constants/setupWorkflow');
const { createLogger } = require('../lib/observability/logger');

describe('leadCampaignCreationService call-only without website', () => {
  const logger = createLogger({ level: 'silent' });

  async function seedCallNoWebsiteRun() {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');

    const user = await User.create({ email: 'call-no-web@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      businessName: 'Acme Plumbing',
      websiteUrl: '',
      industry: 'plumbing',
      services: ['Emergency plumbing'],
      serviceAreas: ['Springfield'],
      goals: { primary: 'calls' },
      businessCountry: 'US',
      contactMethods: { phones: ['+12025550123'] },
      uvp: 'Fast emergency plumbing',
      businessScope: 'local_service',
      valueComplexity: 'low_value_low_complexity',
      budgetTier: 'growth',
      susoVersion: 0,
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });

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

    await SetupStepExecution.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
      status: 'success',
      provider: 'gtm',
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

    const conversionArtifacts = await IntegrationArtifact.find({
      setupRunId: run._id,
      businessId: bc.businessId,
      provider: 'google_ads',
      artifactType: 'ads_conversion_action',
    }).lean();

    const bcLean = await BusinessContext.findOne({ businessId: bc.businessId }).lean();
    return { bc: bcLean, run, conversionArtifacts, customerId: '1234567890' };
  }

  it('creates keywords and call ad artifacts without RSA ad when there is no website', async () => {
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const { bc, run, conversionArtifacts, customerId } = await seedCallNoWebsiteRun();

    const result = await createLeadCampaignsForSetupRun({
      setupRunId: run._id,
      businessId: bc.businessId,
      customerId,
      bc,
      conversionArtifacts,
      logger,
      onlySlot: 'recommended',
    });

    expect(result.slotSummaries).toHaveLength(1);
    expect(result.slotSummaries[0].adResourceName).toBeTruthy();

    const keywordCount = await IntegrationArtifact.countDocuments({
      setupRunId: run._id,
      businessId: bc.businessId,
      artifactType: 'ads_keyword',
    });
    expect(keywordCount).toBeGreaterThan(0);

    const callAd = await IntegrationArtifact.findOne({
      setupRunId: run._id,
      businessId: bc.businessId,
      artifactType: 'ads_call_ad',
    }).lean();
    expect(callAd).toBeTruthy();
    expect(callAd?.externalId).toBe(result.slotSummaries[0].adResourceName);

    const rsaAd = await IntegrationArtifact.findOne({
      setupRunId: run._id,
      businessId: bc.businessId,
      artifactType: 'ads_ad',
    }).lean();
    expect(rsaAd).toBeNull();
  });
});
