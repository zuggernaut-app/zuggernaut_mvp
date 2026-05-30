'use strict';

const mongoose = require('mongoose');
const {
  createAdsAutoCampaign,
  buildCampaignIntent,
  adsIdempotencyKey,
  AdsProviderPreconditionError,
} = require('../services/capabilities/adsAutoCampaignService');
const { mockResourceName } = require('../services/integrations/googleAdsCampaignClient');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { SETUP_STEP_NAMES } = require('../constants/setupWorkflow');
const { createLogger } = require('../lib/observability/logger');

describe('adsAutoCampaignService', () => {
  const logger = createLogger({ level: 'silent' });

  async function seedAdsCampaignRun(email, opts = {}) {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');

    const user = await User.create({ email });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      businessName: opts.businessName ?? 'Acme Plumbing',
      websiteUrl: opts.websiteUrl ?? 'https://acme.example',
      industry: 'plumbing',
      services: ['Emergency plumbing'],
      serviceAreas: ['Springfield'],
      goals: opts.goals ?? { primary: 'calls' },
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
      providerIdentifiers: { customerId: opts.customerId ?? '1234567890' },
    });

    if (opts.withStructuralVerification !== false) {
      await SetupStepExecution.create({
        setupRunId: run._id,
        businessId: bc.businessId,
        stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
        status: 'success',
        provider: 'gtm',
      });
    }

    const convRows = opts.conversions ?? [
      { externalId: '1001', logicalCategory: 'call', name: 'Call conv' },
    ];

    for (const row of convRows) {
      await IntegrationArtifact.create({
        setupRunId: run._id,
        businessId: bc.businessId,
        provider: 'google_ads',
        artifactType: 'ads_conversion_action',
        externalId: row.externalId,
        idempotencyKey: `ads-ca-${run._id}-${row.logicalCategory}`,
        metadata: { logicalCategory: row.logicalCategory, name: row.name },
      });
    }

    return { bc, run, customerId: opts.customerId ?? '1234567890' };
  }

  it('buildCampaignIntent derives names and ad copy from BusinessContext', () => {
    const intent = buildCampaignIntent(
      {
        businessName: 'Acme Plumbing',
        websiteUrl: 'https://acme.example',
        services: ['Emergency plumbing'],
        serviceAreas: ['Springfield'],
        goals: { primary: 'calls' },
      },
      [{ externalId: '1001' }]
    );

    expect(intent.version).toBe(1);
    expect(intent.campaignName).toContain('Acme Plumbing');
    expect(intent.ad.finalUrl).toBe('https://acme.example');
    expect(intent.selectedConversionIds).toEqual(['1001']);
    expect(intent.budget.amountMicros).toBeGreaterThan(0);
  });

  it('creates campaign artifacts in mock mode and persists CampaignPlan', async () => {
    const CampaignPlan = mongoose.model('CampaignPlan');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const { bc, run, customerId } = await seedAdsCampaignRun('ads-create@test.com');

    const result = await createAdsAutoCampaign({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(result.idempotent).toBe(false);
    expect(result.source).toBe('google_ads_api_mock');
    expect(result.summary.campaignCreated).toBe(true);
    expect(result.summary.adGroupCreated).toBe(true);
    expect(result.summary.adCreated).toBe(true);
    expect(result.summary.conversionLinkCount).toBe(1);
    expect(result.summary.campaignExternalId).toBe(
      mockResourceName(customerId, 'campaigns', `zug-campaign-${run._id}`)
    );

    const plan = await CampaignPlan.findOne({ setupRunId: run._id }).lean();
    expect(plan?.status).toBe('applied');
    expect(plan?.intent?.campaignName).toContain('Acme Plumbing');

    const budget = await IntegrationArtifact.findOne({
      setupRunId: run._id,
      artifactType: 'ads_campaign_budget',
    }).lean();
    expect(budget?.idempotencyKey).toBe(adsIdempotencyKey(run._id, 'campaign_budget'));

    const campaign = await IntegrationArtifact.findOne({
      setupRunId: run._id,
      artifactType: 'ads_campaign',
    }).lean();
    expect(campaign?.metadata?.budgetResourceName).toBeTruthy();

    const adGroup = await IntegrationArtifact.findOne({
      setupRunId: run._id,
      artifactType: 'ads_ad_group',
    }).lean();
    expect(adGroup?.metadata?.keywords?.length).toBeGreaterThan(0);

    const ad = await IntegrationArtifact.findOne({
      setupRunId: run._id,
      artifactType: 'ads_ad',
    }).lean();
    expect(ad?.metadata?.finalUrl).toBe('https://acme.example');

    const links = await IntegrationArtifact.find({
      setupRunId: run._id,
      artifactType: 'ads_conversion_link',
    }).lean();
    expect(links).toHaveLength(1);
  });

  it('is idempotent on second run — reuses artifacts without new creates', async () => {
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const { bc, run } = await seedAdsCampaignRun('ads-idem@test.com');

    await createAdsAutoCampaign({ setupRunId: run._id, businessId: bc.businessId, logger });
    const firstCount = await IntegrationArtifact.countDocuments({ setupRunId: run._id, provider: 'google_ads' });

    const second = await createAdsAutoCampaign({ setupRunId: run._id, businessId: bc.businessId, logger });
    const secondCount = await IntegrationArtifact.countDocuments({ setupRunId: run._id, provider: 'google_ads' });

    expect(second.idempotent).toBe(true);
    expect(second.summary.reusedArtifacts).toBeGreaterThan(0);
    expect(secondCount).toBe(firstCount);
  });

  it('rejects when structural verification has not passed', async () => {
    const { bc, run } = await seedAdsCampaignRun('ads-no-verify@test.com', {
      withStructuralVerification: false,
    });

    await expect(
      createAdsAutoCampaign({ setupRunId: run._id, businessId: bc.businessId, logger })
    ).rejects.toMatchObject({ code: 'ADS_TRACKING_NOT_VERIFIED' });
  });

  it('rejects when website URL is missing', async () => {
    const { bc, run } = await seedAdsCampaignRun('ads-no-site@test.com', { websiteUrl: '' });

    await expect(
      createAdsAutoCampaign({ setupRunId: run._id, businessId: bc.businessId, logger })
    ).rejects.toMatchObject({ code: 'ADS_MISSING_WEBSITE_URL' });
  });

  it('rejects when conversion artifacts are missing', async () => {
    const { bc, run } = await seedAdsCampaignRun('ads-no-conv@test.com', { conversions: [] });

    await expect(
      createAdsAutoCampaign({ setupRunId: run._id, businessId: bc.businessId, logger })
    ).rejects.toMatchObject({ code: 'ADS_MISSING_CONVERSIONS' });
  });

  it('rejects when customerId is missing on connection', async () => {
    const { bc, run } = await seedAdsCampaignRun('ads-no-cust@test.com', { customerId: '' });

    await expect(
      createAdsAutoCampaign({ setupRunId: run._id, businessId: bc.businessId, logger })
    ).rejects.toMatchObject({ code: 'ADS_MISSING_CUSTOMER_ID' });
  });

  it('rejects when Ads API is neither mock nor enabled', async () => {
    const prevMock = process.env.GOOGLE_ADS_API_MOCK;
    const prevEnabled = process.env.GOOGLE_ADS_API_ENABLED;
    process.env.GOOGLE_ADS_API_MOCK = 'false';
    process.env.GOOGLE_ADS_API_ENABLED = 'false';

    const { bc, run } = await seedAdsCampaignRun('ads-api-off@test.com');

    await expect(
      createAdsAutoCampaign({ setupRunId: run._id, businessId: bc.businessId, logger })
    ).rejects.toMatchObject({ code: 'ADS_API_NOT_ENABLED' });

    process.env.GOOGLE_ADS_API_MOCK = prevMock;
    process.env.GOOGLE_ADS_API_ENABLED = prevEnabled;
  });

  it('links multiple conversions when both goal conversions exist', async () => {
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const { bc, run } = await seedAdsCampaignRun('ads-both@test.com', {
      goals: { primary: 'both' },
      conversions: [
        { externalId: '1001', logicalCategory: 'call', name: 'Call conv' },
        { externalId: '1002', logicalCategory: 'form', name: 'Form conv' },
      ],
    });

    const result = await createAdsAutoCampaign({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(result.summary.conversionLinkCount).toBe(2);
    const links = await IntegrationArtifact.find({
      setupRunId: run._id,
      artifactType: 'ads_conversion_link',
    }).lean();
    expect(links).toHaveLength(2);
  });

  it('resumes from existing budget and campaign artifacts on partial retry', async () => {
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const { bc, run, customerId } = await seedAdsCampaignRun('ads-partial@test.com');

    await IntegrationArtifact.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      provider: 'google_ads',
      artifactType: 'ads_campaign_budget',
      externalId: `customers/${customerId}/campaignBudgets/zug-budget-${run._id}`,
      idempotencyKey: adsIdempotencyKey(run._id, 'campaign_budget'),
      metadata: { createdBy: 'ads_auto_campaign_v1' },
    });
    await IntegrationArtifact.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      provider: 'google_ads',
      artifactType: 'ads_campaign',
      externalId: `customers/${customerId}/campaigns/zug-campaign-${run._id}`,
      idempotencyKey: adsIdempotencyKey(run._id, 'campaign'),
      metadata: { createdBy: 'ads_auto_campaign_v1' },
    });

    const result = await createAdsAutoCampaign({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(result.summary.reusedArtifacts).toBeGreaterThanOrEqual(2);
    expect(
      await IntegrationArtifact.countDocuments({ setupRunId: run._id, artifactType: 'ads_campaign' })
    ).toBe(1);
    expect(
      await IntegrationArtifact.countDocuments({ setupRunId: run._id, artifactType: 'ads_ad' })
    ).toBe(1);
  });
});
