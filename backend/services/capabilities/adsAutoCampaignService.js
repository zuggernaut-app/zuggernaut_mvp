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
async function persistCampaignPlanValidation(
  setupRunId,
  businessId,
  intent,
  bucketValidation,
  status,
  slot = 'recommended'
) {
  if (!setupRunId) {
    return null;
  }

  return CampaignPlan.findOneAndUpdate(
    { setupRunId, slot },
    {
      $set: {
        businessId,
        slot,
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
 *   budgetAmountMicros?: number,
 * }} ctx
 * @returns {Promise<{ intent: object, bucketValidation: object, plan: object | null }>}
 */
async function prepareCompliantCampaignPlan(ctx) {
  const {
    setupRunId,
    businessId,
    customerId,
    normalized,
    conversionArtifacts,
    budgetAmountMicros,
    slot = 'recommended',
  } = ctx;
  const intent = adsCampaignIntentService.buildCampaignIntentFromNormalized(
    normalized,
    conversionArtifacts,
    { budgetAmountMicros }
  );
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
      'failed_validation',
      slot
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
      'failed_validation',
      slot
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
      'failed_compliance',
      slot
    );
    throwCampaignPlanValidationError(complianceIssues[0], complianceIssues, bucketValidation);
  }

  const bucketValidation = adsCampaignIntentService.buildBucketValidationFromIssues([]);
  const plan = await persistCampaignPlanValidation(
    setupRunId,
    businessId,
    intent,
    bucketValidation,
    'ready',
    slot
  );

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
  const { setupRunId, businessId, logicalKey, intentFingerprint, currentSusoVersion } = ctx;
  const keysToTry = [logicalKey];
  if (logicalKey.startsWith('recommended:')) {
    keysToTry.push(logicalKey.slice('recommended:'.length));
  }

  for (const key of keysToTry) {
    const currentRun = await IntegrationArtifact.findOne({
      setupRunId,
      businessId,
      provider: 'google_ads',
      idempotencyKey: adsIdempotencyKey(setupRunId, key),
    }).lean();
    if (currentRun) return currentRun;
  }

  if (intentFingerprint) {
    const candidate = await findReusableArtifact({
      businessId,
      provider: 'google_ads',
      logicalKey: keysToTry[0],
      fingerprint: intentFingerprint,
    });
    if (!candidate) return null;

    if (susoVersionBlocksCrossRunReuse(candidate.metadata?.susoVersion, currentSusoVersion)) {
      return null;
    }

    return candidate;
  }
  return null;
}

/**
 * @param {number | null | undefined} artifactVersion
 * @param {number} currentSusoVersion
 */
function susoVersionBlocksCrossRunReuse(artifactVersion, currentSusoVersion) {
  return (
    artifactVersion !== null &&
    artifactVersion !== undefined &&
    Number.isFinite(Number(artifactVersion)) &&
    Number(artifactVersion) !== currentSusoVersion
  );
}

/**
 * @param {object} ctx
 */
async function persistAdsArtifact(ctx) {
  const {
    setupRunId,
    businessId,
    artifactType,
    logicalKey,
    externalId,
    metadata,
    intentFingerprint,
    crossRunReuseBlocked = false,
  } = ctx;
  const idempotencyKey =
    intentFingerprint && !crossRunReuseBlocked
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

  const { createLeadCampaignsForSetupRun } = require('./leadCampaignCreationService');
  const result = await createLeadCampaignsForSetupRun({
    setupRunId,
    businessId,
    customerId,
    bc,
    conversionArtifacts,
    logger,
  });

  const primary = result.slotSummaries[0];
  const keywordCount = await IntegrationArtifact.countDocuments({
    setupRunId,
    businessId,
    provider: 'google_ads',
    artifactType: 'ads_keyword',
  });
  const geoCount = await IntegrationArtifact.countDocuments({
    setupRunId,
    businessId,
    provider: 'google_ads',
    artifactType: 'ads_campaign_criterion',
  });
  const summary = {
    campaignCreated: result.slotSummaries.length > 0,
    slotsCreated: result.slotSummaries.length,
    reusedArtifacts: result.reusedArtifacts,
    campaignExternalId: primary?.campaignResourceName ?? null,
    adGroupExternalId: primary?.adGroupResourceName ?? null,
    adExternalId: primary?.adResourceName ?? null,
    budgetExternalId: primary?.budgetResourceName ?? null,
    slotSummaries: result.slotSummaries,
    geoTargetsCreated: geoCount,
    adGroupCreated: Boolean(primary?.adGroupResourceName),
    adCreated: Boolean(primary?.adResourceName),
    keywordsCreated: keywordCount,
    conversionLinkCount: conversionArtifacts.length,
    conversionGoalLinked: result.slotSummaries.length > 0,
    geoExternalIds: await IntegrationArtifact.find({
      setupRunId,
      businessId,
      provider: 'google_ads',
      artifactType: 'ads_campaign_criterion',
    })
      .lean()
      .then((rows) => rows.map((r) => r.externalId)),
    keywordExternalIds: await IntegrationArtifact.find({
      setupRunId,
      businessId,
      provider: 'google_ads',
      artifactType: 'ads_keyword',
    })
      .lean()
      .then((rows) => rows.map((r) => r.externalId)),
    source: result.source,
  };

  return {
    idempotent: result.idempotent,
    summary,
    source: result.source,
  };
}

module.exports = {
  createAdsAutoCampaign,
  AdsProviderPreconditionError,
  buildCampaignIntent,
  adsIdempotencyKey,
  prepareCompliantCampaignPlan,
  findExistingAdsArtifact,
  persistAdsArtifact,
  susoVersionBlocksCrossRunReuse,
};
