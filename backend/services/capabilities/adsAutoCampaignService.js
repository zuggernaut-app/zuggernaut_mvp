'use strict';

const mongoose = require('mongoose');
const { SETUP_STEP_NAMES } = require('../../constants/setupWorkflow');
const { adsCampaignIdempotencyKey, findReusableArtifact, businessScopedIdempotencyKey } = require('../../constants/idempotency');
const { computeBusinessIntentFingerprint } = require('../../lib/idempotency/businessIntentFingerprint');
const {
  createCampaignBudget,
  createCampaign,
  createCampaignGeoTarget,
  createAdGroup,
  createAdGroupKeyword,
  createCustomConversionGoal,
  createResponsiveSearchAd,
  linkCampaignToCustomConversionGoal,
  resolveConversionActionResourceName,
} = require('../integrations/googleAdsCampaignClient');
const { GoogleAdsApiError } = require('../integrations/googleAdsConversionCatalogClient');
const { requireSetupReadyConnection } = require('./setupReadyConnectionService');
const {
  validateBusinessContextAdsReadiness,
  formatAdsReadinessSummary,
} = require('./businessContextAdsReadinessService');
const adsCampaignIntentService = require('./adsCampaignIntentService');
const googleAdsCampaignComplianceService = require('./googleAdsCampaignComplianceService');
const googleAdsGeoTargetClient = require('../integrations/googleAdsGeoTargetClient');
const BusinessContext = mongoose.model('BusinessContext');
const CampaignPlan = mongoose.model('CampaignPlan');
const IntegrationArtifact = mongoose.model('IntegrationArtifact');

class AdsProviderPreconditionError extends Error {
  /**
   * @param {string} message
   * @param {string} [code]
   * @param {import('../integrations/googleAdsApiConfig').GoogleAdsApiErrorDetails | undefined} [googleAdsDetails]
   * @param {{ issues?: object[], bucketValidation?: object, field?: string }} [meta]
   */
  constructor(message, code = 'ADS_PROVIDER_PRECONDITION', googleAdsDetails = undefined, meta = undefined) {
    super(message);
    this.name = 'AdsProviderPreconditionError';
    this.code = code;
    if (googleAdsDetails !== undefined) {
      this.googleAdsDetails = googleAdsDetails;
    }
    if (meta && typeof meta === 'object') {
      if (Array.isArray(meta.issues)) {
        this.issues = meta.issues;
      }
      if (meta.bucketValidation) {
        this.bucketValidation = meta.bucketValidation;
      }
      if (meta.field) {
        this.field = meta.field;
      }
    }
  }
}

/**
 * @param {object} firstIssue
 * @param {object[]} issues
 * @param {object} bucketValidation
 * @param {import('../integrations/googleAdsApiConfig').GoogleAdsApiErrorDetails | undefined} [googleAdsDetails]
 */
function throwCampaignPlanValidationError(firstIssue, issues, bucketValidation, googleAdsDetails = undefined) {
  throw new AdsProviderPreconditionError(firstIssue.message, firstIssue.code, googleAdsDetails, {
    issues,
    bucketValidation,
    field: firstIssue.field,
  });
}

/**
 * @param {import('mongoose').Types.ObjectId | string | undefined} setupRunId
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {object} intent
 * @param {object} bucketValidation
 * @param {string} status
 */
async function persistCampaignPlanValidation(setupRunId, businessId, intent, bucketValidation, status) {
  if (!setupRunId) {
    return null;
  }

  return CampaignPlan.findOneAndUpdate(
    { setupRunId },
    {
      $set: {
        businessId,
        intent,
        bucketValidation,
        status,
      },
    },
    { upsert: true, setDefaultsOnInsert: true, returnDocument: 'after' }
  ).lean();
}

/**
 * Single pre-mutate pipeline: build intent, resolve geo, validate, persist CampaignPlan.
 *
 * @param {{
 *   setupRunId?: import('mongoose').Types.ObjectId | string,
 *   businessId: import('mongoose').Types.ObjectId | string,
 *   customerId: string,
 *   normalized: import('./businessContextAdsReadinessService').AdsReadinessNormalized,
 *   conversionArtifacts: object[],
 * }} ctx
 * @returns {Promise<{ intent: object, bucketValidation: object, plan: object | null }>}
 */
async function prepareCompliantCampaignPlan(ctx) {
  const { setupRunId, businessId, customerId, normalized, conversionArtifacts } = ctx;
  const intent = adsCampaignIntentService.buildCampaignIntentFromNormalized(normalized, conversionArtifacts);
  const primaryLabel = intent.geoTargetLabels[0];

  try {
    const geoTarget = await googleAdsGeoTargetClient.resolvePrimaryGeoTargetConstant({
      businessId,
      customerId,
      label: primaryLabel,
    });
    intent.geoTargets = [
      {
        resourceName: geoTarget.resourceName,
        label: geoTarget.label,
        canonicalName: geoTarget.canonicalName,
        targetType: geoTarget.targetType,
        countryCode: geoTarget.countryCode,
      },
    ];
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Geo target resolution failed.';
    const code =
      err instanceof googleAdsGeoTargetClient.GeoTargetResolutionError
        ? err.code
        : err instanceof GoogleAdsApiError
          ? err.code
          : 'ADS_INTENT_UNRESOLVED_GEO';
    const geoIssue = {
      code,
      field: 'geoTargetLabels',
      message,
      bucket: 'geo',
    };
    const bucketValidation = adsCampaignIntentService.buildBucketValidationFromIssues([geoIssue]);
    await persistCampaignPlanValidation(
      setupRunId,
      businessId,
      intent,
      bucketValidation,
      'failed_validation'
    );
    throwCampaignPlanValidationError(
      geoIssue,
      [geoIssue],
      bucketValidation,
      err instanceof GoogleAdsApiError ? err.details : undefined
    );
  }

  const intentValidation = adsCampaignIntentService.validateCampaignIntent(intent);
  if (!intentValidation.ok) {
    const bucketValidation = adsCampaignIntentService.buildBucketValidationFromIssues(
      intentValidation.issues
    );
    await persistCampaignPlanValidation(
      setupRunId,
      businessId,
      intent,
      bucketValidation,
      'failed_validation'
    );
    throwCampaignPlanValidationError(
      intentValidation.issues[0],
      intentValidation.issues,
      bucketValidation
    );
  }

  try {
    googleAdsCampaignComplianceService.assertGoogleAdsCampaignCompliance(intent);
  } catch (err) {
    const complianceIssues =
      err && typeof err === 'object' && Array.isArray(err.issues) && err.issues.length > 0
        ? err.issues
        : [
            {
              code:
                err && typeof err === 'object' && 'code' in err
                  ? String(err.code)
                  : 'ADS_INTENT_KEYWORD_INVALID_CHARS',
              field: 'keywords',
              message: err instanceof Error ? err.message : 'Keyword compliance check failed.',
              bucket: 'keywords',
            },
          ];
    const bucketValidation = adsCampaignIntentService.buildBucketValidationFromIssues(complianceIssues);
    await persistCampaignPlanValidation(
      setupRunId,
      businessId,
      intent,
      bucketValidation,
      'failed_compliance'
    );
    throwCampaignPlanValidationError(complianceIssues[0], complianceIssues, bucketValidation);
  }

  const bucketValidation = adsCampaignIntentService.buildBucketValidationFromIssues([]);
  const plan = await persistCampaignPlanValidation(setupRunId, businessId, intent, bucketValidation, 'ready');

  return { intent, bucketValidation, plan };
}

/**
 * @param {object} bc — lean BusinessContext (must pass Ads readiness validation)
 * @param {object[]} conversionArtifacts
 * @param {{ businessId?: import('mongoose').Types.ObjectId | string, customerId?: string }} [resolveCtx]
 */
async function buildCampaignIntent(bc, conversionArtifacts, resolveCtx = {}) {
  const readiness = await validateBusinessContextAdsReadiness(bc);
  if (!readiness.ok) {
    throw new AdsProviderPreconditionError(
      formatAdsReadinessSummary(readiness),
      readiness.issues[0]?.code ?? 'ADS_READINESS_INVALID'
    );
  }

  const businessId =
    resolveCtx.businessId ??
    bc.businessId ??
    new mongoose.Types.ObjectId('507f1f77bcf86cd799439011');
  const customerId = resolveCtx.customerId ?? '1234567890';

  const { intent } = await prepareCompliantCampaignPlan({
    businessId,
    customerId,
    normalized: readiness.normalized,
    conversionArtifacts,
  });

  return intent;
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
  const { setupRunId, businessId, logicalKey, intentFingerprint } = ctx;
  const currentRun = await IntegrationArtifact.findOne({
    setupRunId,
    businessId,
    provider: 'google_ads',
    idempotencyKey: adsIdempotencyKey(setupRunId, logicalKey),
  }).lean();
  if (currentRun) return currentRun;

  if (intentFingerprint) {
    return findReusableArtifact({
      businessId,
      provider: 'google_ads',
      logicalKey,
      fingerprint: intentFingerprint,
    });
  }
  return null;
}

/**
 * @param {object} ctx
 */
async function persistAdsArtifact(ctx) {
  const { setupRunId, businessId, artifactType, logicalKey, externalId, metadata, intentFingerprint } =
    ctx;
  const idempotencyKey =
    intentFingerprint
      ? businessScopedIdempotencyKey(businessId, 'google_ads', logicalKey, intentFingerprint)
      : adsIdempotencyKey(setupRunId, logicalKey);
  await IntegrationArtifact.findOneAndUpdate(
    {
      setupRunId,
      businessId,
      provider: 'google_ads',
      artifactType,
      externalId,
    },
    {
      $setOnInsert: { idempotencyKey },
      $set: {
        metadata: {
          ...metadata,
          logicalKey,
          ...(intentFingerprint ? { intentFingerprint } : {}),
        },
      },
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

  const readiness = await validateBusinessContextAdsReadiness(bc);
  if (!readiness.ok) {
    throw new AdsProviderPreconditionError(
      formatAdsReadinessSummary(readiness),
      readiness.issues[0]?.code ?? 'ADS_READINESS_INVALID'
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

  const { intent, plan: planRow } = await prepareCompliantCampaignPlan({
    setupRunId,
    businessId,
    customerId,
    normalized: readiness.normalized,
    conversionArtifacts,
  });

  if (!planRow) {
    throw new AdsProviderPreconditionError('Campaign plan not persisted.', 'ADS_PLAN_PERSIST_FAILED');
  }

  const intentFingerprint = computeBusinessIntentFingerprint(bc);

  let newArtifacts = 0;
  let reusedArtifacts = 0;
  let source = process.env.GOOGLE_ADS_API_MOCK === 'true' ? 'google_ads_api_mock' : 'google_ads_api';

  const clientCtx = { businessId, customerId, setupRunId: setupRunId.toString(), intent };

  async function ensureResource(logicalKey, artifactType, createFn, metadataBuilder) {
    const existing = await findExistingAdsArtifact({
      setupRunId,
      businessId,
      logicalKey,
      intentFingerprint,
    });
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
      intentFingerprint,
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
      name: intent.campaign.budget.name,
      amountMicros: intent.campaign.budget.amountMicros,
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
      name: intent.campaign.name,
      budgetResourceName,
      bidding: intent.campaign.bidding,
      createdBy: 'ads_auto_campaign_v1',
      source,
    })
  );

  const geoExternalIds = [];
  for (let index = 0; index < intent.geoTargets.length; index += 1) {
    const geo = intent.geoTargets[index];
    const logicalKey = `geo_${index}`;
    const geoResourceName = await ensureResource(
      logicalKey,
      'ads_campaign_criterion',
      () =>
        createCampaignGeoTarget({
          ...clientCtx,
          campaignResourceName,
          geoTargetConstant: geo.resourceName,
          geoIndex: index,
        }),
      () => ({
        planId: planRow._id.toString(),
        campaignResourceName,
        geoTargetConstant: geo.resourceName,
        label: geo.label,
        createdBy: 'ads_auto_campaign_v1',
        source,
      })
    );
    geoExternalIds.push(geoResourceName);
  }

  const adGroupResourceName = await ensureResource(
    'ad_group',
    'ads_ad_group',
    () => createAdGroup({ ...clientCtx, campaignResourceName }),
    (resourceName) => ({
      planId: planRow._id.toString(),
      name: intent.adGroup.name,
      campaignResourceName,
      keywordPlan: intent.keywords,
      createdBy: 'ads_auto_campaign_v1',
      source,
    })
  );

  const keywordExternalIds = [];
  for (let index = 0; index < intent.keywords.length; index += 1) {
    const keyword = intent.keywords[index];
    const logicalKey = `keyword_${index}`;
    const keywordResourceName = await ensureResource(
      logicalKey,
      'ads_keyword',
      () =>
        createAdGroupKeyword({
          ...clientCtx,
          adGroupResourceName,
          keywordText: keyword.text,
          matchType: keyword.matchType,
          keywordIndex: index,
        }),
      () => ({
        planId: planRow._id.toString(),
        adGroupResourceName,
        keywordText: keyword.text,
        matchType: keyword.matchType,
        createdBy: 'ads_auto_campaign_v1',
        source,
      })
    );
    keywordExternalIds.push(keywordResourceName);
  }

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
    geoTargetsCreated: geoExternalIds.length,
    adGroupCreated: true,
    adCreated: true,
    keywordsCreated: keywordExternalIds.length,
    reusedArtifacts,
    campaignExternalId: campaignResourceName,
    geoExternalIds,
    adGroupExternalId: adGroupResourceName,
    adExternalId: adResourceName,
    keywordExternalIds,
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
