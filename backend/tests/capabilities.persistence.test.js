'use strict';

const mongoose = require('mongoose');
const { runGbpReadOnlyAudit } = require('../services/capabilities/gbpReadOnlyAuditService');
const { fetchAndPersistConversionCatalog } = require('../services/capabilities/adsConversionCatalogService');
const { runGtmConversionSetup } = require('../services/capabilities/gtmConversionSetupService');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { createLogger } = require('../lib/observability/logger');
const { connectGoogleIntegrations } = require('./fixtures/setupRunFixtures');

describe('capability services persistence', () => {
  const logger = createLogger({ level: 'silent' });

  it('GBP read-only audit writes ProviderSnapshot and AuditReport', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const AuditReport = mongoose.model('AuditReport');
    const ProviderSnapshot = mongoose.model('ProviderSnapshot');

    const user = await User.create({ email: 'cap-gbp@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      businessName: 'Acme',
      websiteUrl: 'https://acme.example',
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });

    await runGbpReadOnlyAudit({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    const report = await AuditReport.findOne({ setupRunId: run._id }).lean();
    expect(report).toBeTruthy();
    expect(report.findings).toBeTruthy();
    expect(report.findings.present).toEqual(expect.arrayContaining(['Business name']));

    const snaps = await ProviderSnapshot.countDocuments({
      setupRunId: run._id,
      snapshotType: 'gbp_profile_read',
    });
    expect(snaps).toBeGreaterThanOrEqual(1);
  });

  it('Ads catalog persists ProviderSnapshot and conversion IntegrationArtifacts', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const ProviderSnapshot = mongoose.model('ProviderSnapshot');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');

    const user = await User.create({ email: 'cap-ads@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      goals: { primary: 'calls' },
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });

    await connectGoogleIntegrations(bc.businessId);

    await fetchAndPersistConversionCatalog({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    const snap = await ProviderSnapshot.findOne({
      setupRunId: run._id,
      snapshotType: 'ads_conversion_catalog',
    }).lean();
    expect(snap?.payload?.source).toBe('google_ads_api_mock');
    expect(snap?.payload?.conversionActions?.length).toBeGreaterThan(0);

    const arts = await IntegrationArtifact.find({
      setupRunId: run._id,
      artifactType: 'ads_conversion_action',
    }).lean();
    expect(arts.length).toBe(1);
    expect(arts[0].metadata.logicalCategory).toBe('call');
  });

  it('GTM setup persists GTM artifacts and container version snapshot', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const ProviderSnapshot = mongoose.model('ProviderSnapshot');

    const user = await User.create({ email: 'cap-gtm@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      websiteUrl: 'https://acme.example',
      goals: { primary: 'calls' },
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });

    await connectGoogleIntegrations(bc.businessId);

    await fetchAndPersistConversionCatalog({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    await runGtmConversionSetup({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    const gtmTags = await IntegrationArtifact.countDocuments({
      setupRunId: run._id,
      provider: 'gtm',
      artifactType: 'gtm_tag',
    });
    expect(gtmTags).toBeGreaterThanOrEqual(1);

    const snap = await ProviderSnapshot.findOne({
      setupRunId: run._id,
      snapshotType: 'gtm_container_version',
    }).lean();
    expect(snap?.payload?.source).toBe('gtm_api_mock');
    expect(snap?.payload?.publishedVersionPath).toBeTruthy();
  });

  it('Ads auto campaign persists budget, campaign, ad group, ad, and conversion links', async () => {
    const { createAdsAutoCampaign } = require('../services/capabilities/adsAutoCampaignService');
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const CampaignPlan = mongoose.model('CampaignPlan');
    const { SETUP_STEP_NAMES } = require('../constants/setupWorkflow');

    const user = await User.create({ email: 'cap-ads-camp@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      businessName: 'Acme',
      websiteUrl: 'https://acme.example',
      goals: { primary: 'calls' },
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });

    await connectGoogleIntegrations(bc.businessId);

    await SetupStepExecution.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
      status: 'success',
      provider: 'gtm',
    });

    await fetchAndPersistConversionCatalog({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    await createAdsAutoCampaign({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    const plan = await CampaignPlan.findOne({ setupRunId: run._id }).lean();
    expect(plan?.status).toBe('applied');

    expect(
      await IntegrationArtifact.countDocuments({ setupRunId: run._id, artifactType: 'ads_campaign_budget' })
    ).toBe(1);
    expect(
      await IntegrationArtifact.countDocuments({ setupRunId: run._id, artifactType: 'ads_campaign' })
    ).toBe(1);
    expect(
      await IntegrationArtifact.countDocuments({ setupRunId: run._id, artifactType: 'ads_ad_group' })
    ).toBe(1);
    expect(
      await IntegrationArtifact.countDocuments({ setupRunId: run._id, artifactType: 'ads_ad' })
    ).toBe(1);
    expect(
      await IntegrationArtifact.countDocuments({ setupRunId: run._id, artifactType: 'ads_custom_conversion_goal' })
    ).toBe(1);
    expect(
      await IntegrationArtifact.countDocuments({
        setupRunId: run._id,
        artifactType: 'ads_conversion_goal_campaign_config',
      })
    ).toBe(1);
  });
});
