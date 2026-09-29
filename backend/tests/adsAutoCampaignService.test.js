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
const { businessScopedIdempotencyKey } = require('../constants/idempotency');
const { computeBusinessIntentFingerprint } = require('../lib/idempotency/businessIntentFingerprint');

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
      services: opts.services ?? ['Emergency plumbing'],
      serviceAreas: ['Springfield'],
      goals: opts.goals ?? { primary: 'forms' },
      businessCountry: opts.businessCountry ?? 'GB',
      contactMethods: opts.contactMethods ?? {},
      uvp: opts.uvp ?? 'Fast emergency plumbing',
      businessScope: opts.businessScope ?? 'local_service',
      valueComplexity: opts.valueComplexity ?? 'low_value_low_complexity',
      budgetTier: opts.budgetTier ?? 'growth',
      susoVersion: opts.susoVersion ?? 0,
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
      { externalId: '1002', logicalCategory: 'form', name: 'Form conv' },
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

  it('buildCampaignIntent derives names and ad copy from BusinessContext', async () => {
    const intent = await buildCampaignIntent(
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
    expect(intent.campaign.name).toContain('Acme Plumbing');
    expect(intent.campaign.bidding).toBe('manual_cpc');
    expect(intent.ad.finalUrl).toBe('https://acme.example');
    expect(intent.ad.headlines.every((text) => text.length <= 30)).toBe(true);
    expect(intent.ad.descriptions.every((text) => text.length <= 90)).toBe(true);
    expect(intent.selectedConversionIds).toEqual(['1001']);
    expect(intent.campaign.budget.amountMicros).toBeGreaterThan(0);
    expect(intent.keywords.length).toBeGreaterThan(0);
    expect(intent.geoTargetLabels).toEqual(['Springfield']);
    expect(intent.geoTargets).toEqual([
      expect.objectContaining({
        resourceName: 'geoTargetConstants/mock-geo-springfield',
        label: 'Springfield',
      }),
    ]);
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
    expect(result.summary.geoTargetsCreated).toBe(1);
    expect(result.summary.adGroupCreated).toBe(true);
    expect(result.summary.adCreated).toBe(true);
    expect(result.summary.conversionLinkCount).toBe(1);
    expect(result.summary.campaignExternalId).toBe(
      mockResourceName(customerId, 'campaigns', `zug-campaign-${run._id}`)
    );

    const plan = await CampaignPlan.findOne({ setupRunId: run._id }).lean();
    expect(plan?.status).toBe('applied');
    expect(plan?.intent?.campaign?.name).toContain('Acme Plumbing');
    expect(plan?.intent?.campaign?.bidding).toBe('manual_cpc');
    expect(plan?.bucketValidation?.campaign?.status).toBe('pass');
    expect(plan?.bucketValidation?.ad_group?.status).toBe('pass');
    expect(plan?.bucketValidation?.ad?.status).toBe('pass');
    expect(plan?.bucketValidation?.keywords?.status).toBe('pass');
    expect(plan?.bucketValidation?.geo?.status).toBe('pass');
    expect(plan?.bucketValidation?.conversions?.status).toBe('pass');
    expect(plan?.intent?.geoTargets).toEqual([
      expect.objectContaining({
        resourceName: 'geoTargetConstants/mock-geo-springfield',
        label: 'Springfield',
      }),
    ]);

    const budget = await IntegrationArtifact.findOne({
      setupRunId: run._id,
      artifactType: 'ads_campaign_budget',
    }).lean();
    const intentFingerprint = computeBusinessIntentFingerprint(bc);
    expect(budget?.idempotencyKey).toBe(
      businessScopedIdempotencyKey(
        bc.businessId,
        'google_ads',
        'recommended:campaign_budget',
        intentFingerprint
      )
    );

    const campaign = await IntegrationArtifact.findOne({
      setupRunId: run._id,
      artifactType: 'ads_campaign',
    }).lean();
    expect(campaign?.metadata?.budgetResourceName).toBeTruthy();
    expect(campaign?.metadata?.susoVersion).toBe(0);

    const geo = await IntegrationArtifact.findOne({
      setupRunId: run._id,
      artifactType: 'ads_campaign_criterion',
    }).lean();
    expect(geo?.idempotencyKey).toBe(
      businessScopedIdempotencyKey(bc.businessId, 'google_ads', 'recommended:geo_0', intentFingerprint)
    );
    expect(geo?.metadata?.geoTargetConstant).toBe('geoTargetConstants/mock-geo-springfield');
    expect(result.summary.geoExternalIds).toHaveLength(1);

    const adGroup = await IntegrationArtifact.findOne({
      setupRunId: run._id,
      artifactType: 'ads_ad_group',
    }).lean();
    expect(adGroup?.metadata?.keywordPlan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: expect.any(String), matchType: 'PHRASE' }),
      ])
    );

    const keywords = await IntegrationArtifact.find({
      setupRunId: run._id,
      artifactType: 'ads_keyword',
    }).lean();
    expect(keywords).toHaveLength(3);
    expect(keywords.every((row) => row.metadata?.keywordText && row.metadata?.matchType === 'PHRASE')).toBe(
      true
    );
    expect(result.summary.keywordsCreated).toBe(3);
    expect(result.summary.keywordExternalIds).toHaveLength(3);

    const ad = await IntegrationArtifact.findOne({
      setupRunId: run._id,
      artifactType: 'ads_ad',
    }).lean();
    expect(ad?.metadata?.finalUrl).toBe('https://acme.example');

    const customGoal = await IntegrationArtifact.findOne({
      setupRunId: run._id,
      artifactType: 'ads_custom_conversion_goal',
    }).lean();
    expect(customGoal?.metadata?.conversionActionResourceNames).toHaveLength(1);

    const goalConfig = await IntegrationArtifact.findOne({
      setupRunId: run._id,
      artifactType: 'ads_conversion_goal_campaign_config',
    }).lean();
    expect(goalConfig?.metadata?.customConversionGoalResourceName).toBe(customGoal?.externalId);
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
    expect(second.summary.keywordsCreated).toBe(3);
    expect(secondCount).toBe(firstCount);
    expect(
      await IntegrationArtifact.countDocuments({ setupRunId: run._id, artifactType: 'ads_keyword' })
    ).toBe(3);
  });

  it('creates campaign when structural verification was skipped', async () => {
    const { bc, run } = await seedAdsCampaignRun('ads-no-verify@test.com', {
      withStructuralVerification: false,
    });

    const result = await createAdsAutoCampaign({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });
    expect(result.summary.campaignCreated).toBe(true);
  });

  it('persists bucketValidation and failed_validation when intent validation fails', async () => {
    const CampaignPlan = mongoose.model('CampaignPlan');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const intentService = require('../services/capabilities/adsCampaignIntentService');
    const { ADS_INTENT_CODES } = require('../constants/adsCampaignIntent');
    const { bc, run } = await seedAdsCampaignRun('ads-intent-fail@test.com');

    jest.spyOn(intentService, 'validateCampaignIntent').mockReturnValueOnce({
      ok: false,
      issues: [
        {
          code: ADS_INTENT_CODES.RSA_HEADLINE_COUNT,
          field: 'ad.headlines',
          message: 'Responsive search ads require at least 3 unique headlines.',
          bucket: 'ad',
        },
      ],
    });

    await expect(
      createAdsAutoCampaign({ setupRunId: run._id, businessId: bc.businessId, logger })
    ).rejects.toMatchObject({
      code: ADS_INTENT_CODES.RSA_HEADLINE_COUNT,
      field: 'ad.headlines',
    });

    const plan = await CampaignPlan.findOne({ setupRunId: run._id }).lean();
    expect(plan?.status).toBe('failed_validation');
    expect(plan?.bucketValidation?.ad?.status).toBe('fail');
    expect(plan?.bucketValidation?.ad?.issues[0]?.code).toBe(ADS_INTENT_CODES.RSA_HEADLINE_COUNT);

    expect(
      await IntegrationArtifact.countDocuments({
        setupRunId: run._id,
        artifactType: { $in: ['ads_campaign', 'ads_campaign_budget', 'ads_ad_group', 'ads_keyword'] },
      })
    ).toBe(0);

    jest.restoreAllMocks();
  });

  it('persists bucketValidation and failed_compliance when keyword compliance fails', async () => {
    const CampaignPlan = mongoose.model('CampaignPlan');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const complianceService = require('../services/capabilities/googleAdsCampaignComplianceService');
    const { ADS_INTENT_CODES } = require('../constants/adsCampaignIntent');
    const { bc, run } = await seedAdsCampaignRun('ads-compliance-fail@test.com');

    jest.spyOn(complianceService, 'assertGoogleAdsCampaignCompliance').mockImplementationOnce(() => {
      const err = new Error('Keyword text contains invalid characters or symbols.');
      err.code = ADS_INTENT_CODES.KEYWORD_INVALID_CHARS;
      err.issues = [
        {
          code: ADS_INTENT_CODES.KEYWORD_INVALID_CHARS,
          field: 'keywords[0].text',
          message: 'Keyword text contains invalid characters or symbols.',
          bucket: 'keywords',
        },
      ];
      throw err;
    });

    await expect(
      createAdsAutoCampaign({ setupRunId: run._id, businessId: bc.businessId, logger })
    ).rejects.toMatchObject({
      code: ADS_INTENT_CODES.KEYWORD_INVALID_CHARS,
      field: 'keywords[0].text',
    });

    const plan = await CampaignPlan.findOne({ setupRunId: run._id }).lean();
    expect(plan?.status).toBe('failed_compliance');
    expect(plan?.bucketValidation?.keywords?.status).toBe('fail');
    expect(plan?.bucketValidation?.keywords?.issues[0]?.code).toBe(
      ADS_INTENT_CODES.KEYWORD_INVALID_CHARS
    );

    expect(
      await IntegrationArtifact.countDocuments({
        setupRunId: run._id,
        artifactType: { $in: ['ads_campaign', 'ads_campaign_budget', 'ads_ad_group', 'ads_keyword'] },
      })
    ).toBe(0);

    jest.restoreAllMocks();
  });

  it('rejects invalid keyword intent before compliance or Google Ads mutations run', async () => {
    const CampaignPlan = mongoose.model('CampaignPlan');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const intentService = require('../services/capabilities/adsCampaignIntentService');
    const complianceService = require('../services/capabilities/googleAdsCampaignComplianceService');
    const { ADS_INTENT_CODES } = require('../constants/adsCampaignIntent');
    const { bc, run } = await seedAdsCampaignRun('ads-invalid-keyword-pre-mutate@test.com');
    const originalBuild = intentService.buildCampaignIntentFromNormalized;
    const complianceSpy = jest.spyOn(complianceService, 'assertGoogleAdsCampaignCompliance');

    jest.spyOn(intentService, 'buildCampaignIntentFromNormalized').mockImplementation((...args) => ({
      ...originalBuild(...args),
      keywords: [{ text: 'bad#keyword', matchType: 'PHRASE' }],
    }));

    await expect(
      createAdsAutoCampaign({ setupRunId: run._id, businessId: bc.businessId, logger })
    ).rejects.toMatchObject({
      code: ADS_INTENT_CODES.KEYWORD_INVALID_CHARS,
      field: 'keywords[0].text',
    });

    expect(complianceSpy).not.toHaveBeenCalled();

    const plan = await CampaignPlan.findOne({ setupRunId: run._id }).lean();
    expect(plan?.status).toBe('failed_validation');
    expect(plan?.bucketValidation?.keywords?.status).toBe('fail');
    expect(plan?.bucketValidation?.keywords?.issues[0]).toEqual(
      expect.objectContaining({
        code: ADS_INTENT_CODES.KEYWORD_INVALID_CHARS,
        field: 'keywords[0].text',
      })
    );

    expect(
      await IntegrationArtifact.countDocuments({
        setupRunId: run._id,
        artifactType: {
          $in: ['ads_campaign', 'ads_campaign_budget', 'ads_ad_group', 'ads_keyword'],
        },
      })
    ).toBe(0);

    jest.restoreAllMocks();
  });

  it('creates campaign with sanitized keyword seeds', async () => {
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const { bc, run } = await seedAdsCampaignRun('ads-sanitized-keywords@test.com', {
      services: ['HVAC repair/service'],
    });

    const result = await createAdsAutoCampaign({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(result.summary.campaignCreated).toBe(true);
    expect(result.summary.keywordsCreated).toBe(3);

    const keywords = await IntegrationArtifact.find({
      setupRunId: run._id,
      artifactType: 'ads_keyword',
    }).lean();
    expect(keywords.map((row) => row.metadata?.keywordText)).toEqual(
      expect.arrayContaining([
        'HVAC repair service Springfield',
        'HVAC repair service near me',
      ])
    );
  });

  it('rejects when website URL is missing', async () => {
    const { bc, run } = await seedAdsCampaignRun('ads-no-site@test.com', { websiteUrl: '' });

    await expect(
      createAdsAutoCampaign({ setupRunId: run._id, businessId: bc.businessId, logger })
    ).rejects.toMatchObject({ code: 'ADS_READINESS_MISSING_WEBSITE_URL' });
  });

  it('rejects when conversion artifacts are missing', async () => {
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const { bc, run } = await seedAdsCampaignRun('ads-no-conv@test.com', { conversions: [] });

    await expect(
      createAdsAutoCampaign({ setupRunId: run._id, businessId: bc.businessId, logger })
    ).rejects.toMatchObject({ code: 'ADS_MISSING_CONVERSIONS' });

    expect(
      await IntegrationArtifact.countDocuments({
        setupRunId: run._id,
        artifactType: { $in: ['ads_campaign', 'ads_campaign_budget', 'ads_ad_group', 'ads_keyword'] },
      })
    ).toBe(0);
  });

  it('persists bucketValidation and failed_validation when geo resolution fails', async () => {
    const CampaignPlan = mongoose.model('CampaignPlan');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const geoClient = require('../services/integrations/googleAdsGeoTargetClient');
    const { ADS_INTENT_CODES } = require('../constants/adsCampaignIntent');
    const { bc, run } = await seedAdsCampaignRun('ads-geo-fail@test.com');

    jest.spyOn(geoClient, 'resolvePrimaryGeoTargetConstant').mockRejectedValueOnce(
      new geoClient.GeoTargetResolutionError(
        'Could not resolve a unique geographic target for "The Lost City of Z".',
        ADS_INTENT_CODES.UNRESOLVED_GEO
      )
    );

    await expect(
      createAdsAutoCampaign({ setupRunId: run._id, businessId: bc.businessId, logger })
    ).rejects.toMatchObject({
      code: ADS_INTENT_CODES.UNRESOLVED_GEO,
      field: 'geoTargetLabels',
    });

    const plan = await CampaignPlan.findOne({ setupRunId: run._id }).lean();
    expect(plan?.status).toBe('failed_validation');
    expect(plan?.bucketValidation?.geo?.status).toBe('fail');
    expect(plan?.bucketValidation?.geo?.issues[0]?.code).toBe(ADS_INTENT_CODES.UNRESOLVED_GEO);

    expect(
      await IntegrationArtifact.countDocuments({
        setupRunId: run._id,
        artifactType: { $in: ['ads_campaign', 'ads_campaign_budget', 'ads_ad_group', 'ads_keyword'] },
      })
    ).toBe(0);

    jest.restoreAllMocks();
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
      businessCountry: 'US',
      contactMethods: { phones: ['+12025550123'] },
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
    expect(result.summary.conversionGoalLinked).toBe(true);
    expect(result.summary.slotsCreated).toBe(2);
    expect(result.summary.geoTargetsCreated).toBe(2);
    expect(result.summary.keywordsCreated).toBe(6);

    const customGoals = await IntegrationArtifact.find({
      setupRunId: run._id,
      artifactType: 'ads_custom_conversion_goal',
    }).lean();
    expect(customGoals).toHaveLength(2);
    for (const goal of customGoals) {
      expect(goal.metadata?.conversionActionResourceNames).toHaveLength(1);
    }

    const goalConfigs = await IntegrationArtifact.find({
      setupRunId: run._id,
      artifactType: 'ads_conversion_goal_campaign_config',
    }).lean();
    expect(goalConfigs).toHaveLength(2);
    for (const goalConfig of goalConfigs) {
      expect(goalConfig.metadata?.customConversionGoalResourceName).toBeTruthy();
    }
  });

  it('resumes from existing budget and campaign artifacts on partial retry', async () => {
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const { bc, run, customerId } = await seedAdsCampaignRun('ads-partial@test.com');

    await IntegrationArtifact.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      provider: 'google_ads',
      artifactType: 'ads_campaign_budget',
      externalId: mockResourceName(customerId, 'campaignBudgets', `zug-budget-${run._id}`),
      idempotencyKey: adsIdempotencyKey(run._id, 'recommended:campaign_budget'),
      metadata: { createdBy: 'ads_auto_campaign_v1' },
    });
    await IntegrationArtifact.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      provider: 'google_ads',
      artifactType: 'ads_campaign',
      externalId: mockResourceName(customerId, 'campaigns', `zug-campaign-${run._id}`),
      idempotencyKey: adsIdempotencyKey(run._id, 'recommended:campaign'),
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

  it('does not reuse cross-run artifacts when metadata.susoVersion mismatches', async () => {
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const { bc, run } = await seedAdsCampaignRun('ads-suso-mismatch@test.com', { susoVersion: 1 });

    await createAdsAutoCampaign({ setupRunId: run._id, businessId: bc.businessId, logger });

    await BusinessContext.updateOne({ businessId: bc.businessId }, { $set: { susoVersion: 2 } });

    const run2 = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });
    await IntegrationArtifact.create({
      setupRunId: run2._id,
      businessId: bc.businessId,
      provider: 'google_ads',
      artifactType: 'ads_conversion_action',
      externalId: '1001',
      idempotencyKey: `ads-ca-${run2._id}-call`,
      metadata: { logicalCategory: 'call', name: 'Call conv' },
    });

    const second = await createAdsAutoCampaign({
      setupRunId: run2._id,
      businessId: bc.businessId,
      logger,
    });

    expect(second.summary.campaignCreated).toBe(true);
    expect(
      await IntegrationArtifact.countDocuments({
        setupRunId: run2._id,
        artifactType: 'ads_campaign',
      })
    ).toBe(1);
    const run2Campaign = await IntegrationArtifact.findOne({
      setupRunId: run2._id,
      artifactType: 'ads_campaign',
    }).lean();
    expect(run2Campaign?.metadata?.susoVersion).toBe(2);
    expect(run2Campaign?.idempotencyKey).toBe(adsIdempotencyKey(run2._id, 'recommended:campaign'));
  });
});
