'use strict';

const mongoose = require('mongoose');
const { SETUP_STEP_NAMES } = require('../../constants/setupWorkflow');
const { adsCampaignIdempotencyKey } = require('../../constants/idempotency');
const {
  createCampaignBudget,
  createCampaign,
  createAdGroup,
  createCustomConversionGoal,
  createResponsiveSearchAd,
  linkCampaignToCustomConversionGoal,
  resolveConversionActionResourceName,
  truncateRsaText,
} = require('../integrations/googleAdsCampaignClient');
const { GoogleAdsApiError } = require('../integrations/googleAdsConversionCatalogClient');
const { requireSetupReadyConnection } = require('./setupReadyConnectionService');
const BusinessContext = mongoose.model('BusinessContext');
const CampaignPlan = mongoose.model('CampaignPlan');
const IntegrationArtifact = mongoose.model('IntegrationArtifact');
const DEFAULT_DAILY_BUDGET_MICROS = 10_000_000;

class AdsProviderPreconditionError extends Error {
  /**
   * @param {string} message
   * @param {string} [code]
   * @param {import('../integrations/googleAdsApiConfig').GoogleAdsApiErrorDetails | undefined} [googleAdsDetails]
   */
  constructor(message, code = 'ADS_PROVIDER_PRECONDITION', googleAdsDetails = undefined) {
    super(message);
    this.name = 'AdsProviderPreconditionError';
    this.code = code;
    if (googleAdsDetails !== undefined) {
      this.googleAdsDetails = googleAdsDetails;
    }
  }
}

/**
 * @param {object} bc — lean BusinessContext
 * @param {object[]} conversionArtifacts
 */
function buildCampaignIntent(bc, conversionArtifacts) {
  const businessName = bc.businessName?.trim() || 'Business';
  const websiteUrl = bc.websiteUrl?.trim() || '';
  const primaryService = Array.isArray(bc.services) && bc.services[0] ? bc.services[0] : bc.industry ?? 'services';
  const area = Array.isArray(bc.serviceAreas) && bc.serviceAreas[0] ? bc.serviceAreas[0] : 'local area';

  return {
    version: 1,
    businessName,
    websiteUrl,
    goals: bc.goals ?? null,
    serviceAreas: bc.serviceAreas ?? [],
    selectedConversionIds: conversionArtifacts.map((a) => a.externalId),
    campaignName: `${businessName} — Zuggernaut Search`,
    adGroupName: `${businessName} — Core`,
    bidding: 'maximize_conversions',
    budget: {
      name: `${businessName} — Daily Budget`,
      amountMicros: DEFAULT_DAILY_BUDGET_MICROS,
    },
    keywords: [
      `${primaryService} ${area}`.trim(),
      `${businessName} ${area}`.trim(),
      `${primaryService} near me`,
    ],
    ad: {
      finalUrl: websiteUrl,
      headlines: [
        truncateRsaText(businessName, 30),
        truncateRsaText(`${primaryService} in ${area}`, 30),
        'Get a Free Quote Today',
      ],
      descriptions: [
        truncateRsaText(`Trusted ${primaryService} serving ${area}. Contact ${businessName} today.`, 90),
        truncateRsaText(`Professional ${primaryService}. Visit our website to learn more.`, 90),
      ],
    },
  };
}

/**
 * @param {import('mongoose').Types.ObjectId} setupRunId
 * @param {string} logicalKey
 */
function adsIdempotencyKey(setupRunId, logicalKey) {
  return adsCampaignIdempotencyKey(setupRunId, logicalKey);
}

/**
 * @param {object} ctx
 */
async function findExistingAdsArtifact(ctx) {
  const { setupRunId, businessId, logicalKey } = ctx;
  return IntegrationArtifact.findOne({
    setupRunId,
    businessId,
    provider: 'google_ads',
    idempotencyKey: adsIdempotencyKey(setupRunId, logicalKey),
  }).lean();
}

/**
 * @param {object} ctx
 */
async function persistAdsArtifact(ctx) {
  const { setupRunId, businessId, artifactType, logicalKey, externalId, metadata } = ctx;
  await IntegrationArtifact.findOneAndUpdate(
    {
      setupRunId,
      businessId,
      provider: 'google_ads',
      artifactType,
      externalId,
    },
    {
      $setOnInsert: { idempotencyKey: adsIdempotencyKey(setupRunId, logicalKey) },
      $set: { metadata },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

/**
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId} ctx.setupRunId
 * @param {import('mongoose').Types.ObjectId} ctx.businessId
 * @param {import('pino').Logger} ctx.logger
 */
async function createAdsAutoCampaign(ctx) {
  const { setupRunId, businessId, logger } = ctx;

  const bc = await BusinessContext.findOne({ businessId }).lean();
  if (!bc) {
    throw new AdsProviderPreconditionError(
      'BusinessContext missing for campaign creation.',
      'ADS_MISSING_BUSINESS_CONTEXT'
    );
  }

  if (!bc.websiteUrl?.trim()) {
    throw new AdsProviderPreconditionError(
      'Website URL is required on BusinessContext for campaign creation.',
      'ADS_MISSING_WEBSITE_URL'
    );
  }

  const conversionArtifacts = await IntegrationArtifact.find({
    setupRunId,
    businessId,
    provider: 'google_ads',
    artifactType: 'ads_conversion_action',
  }).lean();

  if (conversionArtifacts.length < 1) {
    throw new AdsProviderPreconditionError(
      'Selected Ads conversion actions are required before campaign creation.',
      'ADS_MISSING_CONVERSIONS'
    );
  }

  const { customerId } = await requireSetupReadyConnection(
    businessId,
    'google_ads',
    AdsProviderPreconditionError
  );

  if (process.env.GOOGLE_ADS_API_MOCK !== 'true' && process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    throw new AdsProviderPreconditionError(
      'Google Ads API is not enabled (set GOOGLE_ADS_API_ENABLED=true after wiring credentials).',
      'ADS_API_NOT_ENABLED'
    );
  }

  const intent = buildCampaignIntent(bc, conversionArtifacts);

  await CampaignPlan.findOneAndUpdate(
    { setupRunId },
    {
      $set: {
        businessId,
        intent,
        status: 'ready',
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  const planRow = await CampaignPlan.findOne({ setupRunId }).lean();
  if (!planRow) {
    throw new AdsProviderPreconditionError('Campaign plan not persisted.', 'ADS_PLAN_PERSIST_FAILED');
  }

  let newArtifacts = 0;
  let reusedArtifacts = 0;
  let source = process.env.GOOGLE_ADS_API_MOCK === 'true' ? 'google_ads_api_mock' : 'google_ads_api';

  const clientCtx = { businessId, customerId, setupRunId: setupRunId.toString(), intent };

  async function ensureResource(logicalKey, artifactType, createFn, metadataBuilder) {
    const existing = await findExistingAdsArtifact({ setupRunId, businessId, logicalKey });
    if (existing) {
      reusedArtifacts += 1;
      logger.info(
        {
          setupRunId: setupRunId.toString(),
          businessId: businessId.toString(),
          logicalKey,
          artifactType,
          externalId: existing.externalId,
        },
        'ads artifact reused (idempotent skip)'
      );
      return existing.externalId;
    }

    let created;
    try {
      created = await createFn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Google Ads mutation failed';
      const code = err instanceof GoogleAdsApiError ? err.code : 'GOOGLE_ADS_MUTATE_FAILED';
      const googleAdsDetails = err instanceof GoogleAdsApiError ? err.details : undefined;
      logger.error(
        {
          setupRunId: setupRunId.toString(),
          businessId: businessId.toString(),
          logicalKey,
          artifactType,
          code,
          fieldViolations: googleAdsDetails?.fieldViolations ?? [],
          googleAdsErrors: googleAdsDetails?.googleAdsErrors ?? [],
          requestId: googleAdsDetails?.requestId ?? null,
        },
        'ads provider mutation failed'
      );
      throw new AdsProviderPreconditionError(msg, code, googleAdsDetails);
    }

    newArtifacts += 1;
    source = created.source ?? source;
    await persistAdsArtifact({
      setupRunId,
      businessId,
      artifactType,
      logicalKey,
      externalId: created.resourceName,
      metadata: metadataBuilder(created.resourceName),
    });
    return created.resourceName;
  }

  const budgetResourceName = await ensureResource(
    'campaign_budget',
    'ads_campaign_budget',
    () => createCampaignBudget(clientCtx),
    (resourceName) => ({
      planId: planRow._id.toString(),
      name: intent.budget.name,
      amountMicros: intent.budget.amountMicros,
      createdBy: 'ads_auto_campaign_v1',
      source,
    })
  );

  const campaignResourceName = await ensureResource(
    'campaign',
    'ads_campaign',
    () => createCampaign({ ...clientCtx, budgetResourceName }),
    (resourceName) => ({
      planId: planRow._id.toString(),
      name: intent.campaignName,
      budgetResourceName,
      bidding: intent.bidding,
      createdBy: 'ads_auto_campaign_v1',
      source,
    })
  );

  const adGroupResourceName = await ensureResource(
    'ad_group',
    'ads_ad_group',
    () => createAdGroup({ ...clientCtx, campaignResourceName }),
    (resourceName) => ({
      planId: planRow._id.toString(),
      name: intent.adGroupName,
      campaignResourceName,
      keywords: intent.keywords,
      createdBy: 'ads_auto_campaign_v1',
      source,
    })
  );

  const adResourceName = await ensureResource(
    'ad',
    'ads_ad',
    () => createResponsiveSearchAd({ ...clientCtx, adGroupResourceName }),
    (resourceName) => ({
      planId: planRow._id.toString(),
      campaignResourceName,
      adGroupResourceName,
      finalUrl: intent.ad.finalUrl,
      createdBy: 'ads_auto_campaign_v1',
      source,
    })
  );

  const conversionActionResourceNames = conversionArtifacts.map((conv) =>
    resolveConversionActionResourceName(customerId, conv.metadata?.resourceName ?? null, conv.externalId)
  );

  const customGoalResourceName = await ensureResource(
    'custom_conversion_goal',
    'ads_custom_conversion_goal',
    () =>
      createCustomConversionGoal({
        businessId,
        customerId,
        setupRunId: setupRunId.toString(),
        name: `${intent.businessName} — Zuggernaut Conversions`,
        conversionActionResourceNames,
      }),
    () => ({
      planId: planRow._id.toString(),
      campaignResourceName,
      conversionActionResourceNames,
      selectedConversionIds: intent.selectedConversionIds,
      createdBy: 'ads_auto_campaign_v1',
      source,
    })
  );

  await ensureResource(
    'conversion_goal_campaign_config',
    'ads_conversion_goal_campaign_config',
    () =>
      linkCampaignToCustomConversionGoal({
        businessId,
        customerId,
        setupRunId: setupRunId.toString(),
        campaignResourceName,
        customConversionGoalResourceName: customGoalResourceName,
      }),
    () => ({
      planId: planRow._id.toString(),
      campaignResourceName,
      customConversionGoalResourceName: customGoalResourceName,
      conversionActionResourceNames,
      selectedConversionIds: intent.selectedConversionIds,
      createdBy: 'ads_auto_campaign_v1',
      source,
    })
  );

  await CampaignPlan.updateOne({ setupRunId }, { $set: { status: 'applied' } });

  const summary = {
    campaignCreated: true,
    adGroupCreated: true,
    adCreated: true,
    reusedArtifacts,
    campaignExternalId: campaignResourceName,
    adGroupExternalId: adGroupResourceName,
    adExternalId: adResourceName,
    budgetExternalId: budgetResourceName,
    conversionLinkCount: conversionArtifacts.length,
    conversionGoalLinked: true,
    customConversionGoalExternalId: customGoalResourceName,
    source,
  };

  logger.info(
    {
      setupRunId: setupRunId.toString(),
      businessId: businessId.toString(),
      stepName: SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
      provider: 'google_ads',
      ...summary,
    },
    'ads campaign artifacts recorded'
  );

  return {
    idempotent: newArtifacts === 0,
    summary,
    source,
  };
}

module.exports = {
  createAdsAutoCampaign,
  AdsProviderPreconditionError,
  buildCampaignIntent,
  adsIdempotencyKey,
};
