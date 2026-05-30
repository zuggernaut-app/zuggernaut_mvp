'use strict';

const mongoose = require('mongoose');
const { SETUP_STEP_NAMES } = require('../../constants/setupWorkflow');
const { adsCampaignIdempotencyKey } = require('../../constants/idempotency');
const {
  createCampaignBudget,
  createCampaign,
  createAdGroup,
  createResponsiveSearchAd,
} = require('../integrations/googleAdsCampaignClient');
const { GoogleAdsApiError } = require('../integrations/googleAdsConversionCatalogClient');
const { requireSetupReadyConnection } = require('./setupReadyConnectionService');
const BusinessContext = mongoose.model('BusinessContext');
const CampaignPlan = mongoose.model('CampaignPlan');
const IntegrationArtifact = mongoose.model('IntegrationArtifact');
const SetupStepExecution = mongoose.model('SetupStepExecution');

const DEFAULT_DAILY_BUDGET_MICROS = 10_000_000;

class AdsProviderPreconditionError extends Error {
  constructor(message, code = 'ADS_PROVIDER_PRECONDITION') {
    super(message);
    this.name = 'AdsProviderPreconditionError';
    this.code = code;
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
        `${businessName}`,
        `${primaryService} in ${area}`,
        'Get a Free Quote Today',
      ],
      descriptions: [
        `Trusted ${primaryService} serving ${area}. Contact ${businessName} today.`,
        `Professional ${primaryService}. Visit our website to learn more.`,
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
 * @param {import('mongoose').Types.ObjectId} setupRunId
 * @param {import('mongoose').Types.ObjectId} businessId
 */
async function assertStructuralVerificationPassed(setupRunId, businessId) {
  const step = await SetupStepExecution.findOne({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
    status: 'success',
  }).lean();

  if (!step) {
    throw new AdsProviderPreconditionError(
      'Structural verification must pass before Ads campaign creation.',
      'ADS_TRACKING_NOT_VERIFIED'
    );
  }
}

/**
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId} ctx.setupRunId
 * @param {import('mongoose').Types.ObjectId} ctx.businessId
 * @param {import('pino').Logger} ctx.logger
 */
async function createAdsAutoCampaign(ctx) {
  const { setupRunId, businessId, logger } = ctx;

  await assertStructuralVerificationPassed(setupRunId, businessId);

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
      throw new AdsProviderPreconditionError(msg, code);
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

  for (const conv of conversionArtifacts) {
    const linkKey = `conversion_link_${conv.externalId}`;
    const existingLink = await findExistingAdsArtifact({ setupRunId, businessId, logicalKey: linkKey });
    if (existingLink) {
      reusedArtifacts += 1;
      continue;
    }

    newArtifacts += 1;
    const linkResourceName = `customers/${customerId}/campaignConversionGoals/zug-link-${setupRunId}-${conv.externalId}`;
    await persistAdsArtifact({
      setupRunId,
      businessId,
      artifactType: 'ads_conversion_link',
      logicalKey: linkKey,
      externalId: linkResourceName,
      metadata: {
        planId: planRow._id.toString(),
        campaignResourceName,
        conversionExternalId: conv.externalId,
        conversionResourceName: conv.metadata?.resourceName ?? null,
        logicalCategory: conv.metadata?.logicalCategory ?? null,
        createdBy: 'ads_auto_campaign_v1',
        source,
      },
    });
  }

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
