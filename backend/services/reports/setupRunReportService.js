'use strict';

const mongoose = require('mongoose');
const { SETUP_STEP_NAMES } = require('../../constants/setupWorkflow');
const { detectStuckSetupRun } = require('../setupRunStuckDetection');
const { existingCompensation } = require('../compensation/setupRunCompensationService');
const {
  errorCodeFromStepDetails,
  resolveSetupUserErrorMessage,
  sanitizeSetupErrorSummary,
  sanitizeStepErrorSummary,
} = require('../../lib/setupUserErrorMessages');
const { buildSupportPlaybook } = require('../../lib/setupSupportPlaybook');
const BusinessContext = mongoose.model('BusinessContext');
const SetupRun = mongoose.model('SetupRun');
const SetupStepExecution = mongoose.model('SetupStepExecution');
const AuditReport = mongoose.model('AuditReport');
const IntegrationArtifact = mongoose.model('IntegrationArtifact');
const CampaignPlan = mongoose.model('CampaignPlan');

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {object | null | undefined} meta
 * @param {string} key
 */
function metaValue(meta, key) {
  if (!isObject(meta)) return undefined;
  return meta[key];
}

/**
 * @param {object[]} steps
 * @param {string} stepName
 */
function findStep(steps, stepName) {
  return steps.find((s) => s.stepName === stepName) ?? null;
}

/**
 * @param {object | null} step
 */
function stepSummary(step) {
  if (!step || !isObject(step.details)) return null;
  const summary = step.details.summary;
  return isObject(summary) ? summary : null;
}

/**
 * @param {string} status
 */
function mapOutcomeKind(status) {
  switch (status) {
    case 'SUCCEEDED':
      return 'succeeded';
    case 'FAILED':
      return 'failed';
    case 'GTM_SNIPPET_PENDING':
      return 'snippet_pending';
    case 'GTM_PROVISIONING_REQUIRED':
    case 'ADS_PROVISIONING_REQUIRED':
      return 'provisioning_required';
    case 'SETUP_NEEDS_TRACKING_FIX':
      return 'tracking_fix';
    case 'SETUP_NEEDS_MANUAL_REVIEW':
      return 'manual_review';
    case 'RUNNING':
    case 'USER_INPUT_COLLECTED':
      return 'in_progress';
    default:
      return 'in_progress';
  }
}

/**
 * @param {string} kind
 * @param {string | null | undefined} lastErrorSummary
 */
function outcomeHeadline(kind, lastErrorSummary, errorCode) {
  const sanitizedSummary = sanitizeSetupErrorSummary(lastErrorSummary, errorCode);
  switch (kind) {
    case 'succeeded':
      return 'Google Ads setup completed successfully.';
    case 'failed':
      return sanitizedSummary ?? 'Setup failed.';
    case 'snippet_pending':
      return 'GTM snippet must be installed before Ads campaign creation can continue.';
    case 'provisioning_required':
      return sanitizedSummary ?? 'Provisioning approval is required before setup can continue.';
    case 'tracking_fix':
      return 'Tracking setup needs attention before continuing.';
    case 'manual_review':
      return 'Setup paused until Google integrations are connected.';
    case 'in_progress':
      return 'Setup is still in progress.';
    default:
      return 'Setup status unknown.';
  }
}

/**
 * @param {string} kind
 * @param {object | null | undefined} structuralEvidence
 */
function buildRecovery(kind, structuralEvidence) {
  const publicContainerId =
    isObject(structuralEvidence) && typeof structuralEvidence.publicContainerId === 'string'
      ? structuralEvidence.publicContainerId
      : null;

  switch (kind) {
    case 'snippet_pending':
      return {
        title: 'Install the Google Tag Manager snippet',
        steps: [
          'Add the GTM container snippet to the <head> of every page on your website.',
          publicContainerId
            ? `Use container ID ${publicContainerId} from your connected GTM account.`
            : 'Use the container ID from your connected GTM account.',
          'After installing, start a new setup run to continue to Google Ads campaign creation.',
        ],
      };
    case 'provisioning_required':
      return {
        title: 'Approve Google resource provisioning',
        steps: [
          'Open the setup progress page for this run.',
          'Review what Zuggernaut will create (GTM account/container/workspace or Google Ads customer).',
          'Approve provisioning, then start a new setup run so the workflow can create resources and continue.',
        ],
      };
    case 'tracking_fix':
      return {
        title: 'Fix tracking before retrying setup',
        steps: [
          'Confirm your website URL matches where the GTM container is loaded.',
          'Review verification details below and resolve any missing tags, triggers, or conversion links.',
          'Start a new setup run after fixes are live on your site.',
        ],
      };
    case 'manual_review':
      return {
        title: 'Connect required Google integrations',
        steps: [
          'Connect Google Tag Manager and Google Ads on the setup page.',
          'Optionally connect Google Business Profile for a read-only audit.',
          'Start a new setup run once integrations show as connected.',
        ],
      };
    case 'failed':
      return {
        title: 'Retry setup after fixing the error',
        steps: [
          'Review the error summary and step history below.',
          'Fix integration or configuration issues, then start a new setup run.',
          'If the run appears stuck in RUNNING, verify the Temporal worker is running.',
        ],
      };
    case 'in_progress':
      return {
        title: 'Setup still running',
        steps: [
          'Wait for the workflow to advance — refresh this page periodically.',
          'If status stays RUNNING for several minutes, verify the Temporal worker logs and MongoDB connectivity.',
        ],
      };
    default:
      return null;
  }
}

/**
 * @param {object | null | undefined} meta
 * @param {object[]} steps
 */
function normalizeGbpAudit(meta, steps) {
  const auditStep = findStep(steps, SETUP_STEP_NAMES.GBP_AUDIT);
  const metaStatus = metaValue(meta, 'gbpAudit');
  const guidanceMeta = metaValue(meta, 'gbpGuidance');
  const skipped = auditStep?.status === 'skipped' || metaStatus === 'skipped' || metaStatus === 'guidance';
  const guidance = metaStatus === 'guidance' || isObject(guidanceMeta);
  const complete = auditStep?.status === 'success' || metaStatus === 'complete';

  let status = 'not_run';
  if (guidance) status = 'guidance';
  else if (skipped) status = 'skipped';
  else if (complete) status = 'complete';

  const summary =
    (isObject(metaValue(meta, 'gbpAuditSummary')) ? metaValue(meta, 'gbpAuditSummary') : null) ??
    stepSummary(auditStep);

  const stepReason = isObject(auditStep?.details) ? auditStep.details.reason : null;
  const stepGuidance = isObject(auditStep?.details?.guidance) ? auditStep.details.guidance : null;

  return {
    status,
    summary: isObject(summary) ? summary : null,
    reason: (isObject(guidanceMeta) ? guidanceMeta.code : null) ?? stepReason,
    guidance: isObject(guidanceMeta) ? guidanceMeta : stepGuidance,
    blocking: false,
  };
}

/**
 * @param {object | null | undefined} meta
 * @param {object[]} steps
 */
/**
 * @param {unknown} value
 * @returns {number}
 */
function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * @param {object | null | undefined} meta
 * @param {object[]} steps
 * @param {string} setupRunStatus
 * @param {string | null | undefined} lastErrorSummary
 */
function normalizeConversionActions(meta, steps, setupRunStatus, lastErrorSummary) {
  const manageStep = findStep(steps, SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS);
  if (!manageStep) {
    return {
      status: 'not_run',
      slotsResolved: 0,
      created: 0,
      reused: 0,
      message: null,
    };
  }

  const metaOk = metaValue(meta, 'conversionActionManagement') === 'ok';
  const stepSuccess = manageStep.status === 'success';
  const stepDetails = isObject(manageStep.details) ? manageStep.details : null;

  const slotsResolved = numberOrZero(
    metaValue(meta, 'conversionActionSlotsResolved') ?? stepDetails?.slotsResolved
  );
  const created = numberOrZero(
    metaValue(meta, 'conversionActionsCreated') ?? stepDetails?.created
  );
  const reused = numberOrZero(metaValue(meta, 'conversionActionsReused') ?? stepDetails?.reused);

  if (stepSuccess || metaOk) {
    return {
      status: 'ready',
      slotsResolved,
      created,
      reused,
      message: null,
    };
  }

  const message = sanitizeSetupErrorSummary(
    manageStep.lastErrorSummary ??
      (typeof lastErrorSummary === 'string' ? lastErrorSummary : null) ??
      'Conversion actions need review before setup can continue.',
    errorCodeFromStepDetails(stepDetails)
  );

  if (setupRunStatus === 'FAILED' && manageStep.status === 'failed') {
    return {
      status: 'failed',
      slotsResolved,
      created,
      reused,
      message,
    };
  }

  if (manageStep.status === 'failed') {
    return {
      status: 'manual_review',
      slotsResolved,
      created,
      reused,
      message,
    };
  }

  return {
    status: 'not_run',
    slotsResolved: 0,
    created: 0,
    reused: 0,
    message: null,
  };
}

/**
 * @param {object} conversionActions
 */
function buildConversionActionRecovery(conversionActions) {
  const message = conversionActions.message ?? '';

  if (conversionActions.status === 'failed') {
    return {
      title: 'Conversion action creation failed',
      steps: [
        message,
        'Review the step history below and confirm your Google Ads account permissions.',
        'After fixing the issue, start a new setup run to retry conversion action management.',
      ],
    };
  }

  if (conversionActions.status !== 'manual_review') {
    return null;
  }

  if (/goals are required/i.test(message)) {
    return {
      title: 'Confirm your business goals',
      steps: [
        'Open business review and confirm your primary goal (calls, forms, or both).',
        'Save the confirmed business context, then start a new setup run.',
      ],
    };
  }

  if (/creation is disabled/i.test(message)) {
    return {
      title: 'Conversion actions need manual setup',
      steps: [
        'Your Google Ads account is missing required conversion actions and automatic creation is disabled.',
        'Create the required conversion actions in Google Ads, or enable creation in your deployment configuration.',
        'Start a new setup run after the required actions exist in your account.',
      ],
    };
  }

  return {
    title: 'Conversion actions need review',
    steps: [
      message,
      'Confirm Google Ads is connected and your account has the required conversion actions.',
      'Start a new setup run after resolving the issue.',
    ],
  };
}

/**
 * @param {string | { text: string, href?: string, external?: boolean }} step
 * @returns {{ text: string, href?: string, external?: boolean }}
 */
function normalizeRecoveryStep(step) {
  if (typeof step === 'string') return { text: step };
  if (step && typeof step === 'object' && typeof step.text === 'string') return step;
  return { text: String(step) };
}

/**
 * @param {object | null | undefined} recovery
 * @returns {object | null}
 */
function normalizeRecovery(recovery) {
  if (!recovery || typeof recovery !== 'object') return null;
  return {
    title: recovery.title,
    steps: Array.isArray(recovery.steps) ? recovery.steps.map(normalizeRecoveryStep) : [],
    ...(Array.isArray(recovery.advancedSteps) && recovery.advancedSteps.length > 0
      ? { advancedSteps: recovery.advancedSteps.map(normalizeRecoveryStep) }
      : {}),
  };
}

/**
 * @param {object} ctx
 */
function resolveSetupRecovery(ctx) {
  const publicContainerId =
    ctx.publicContainerId ??
    (isObject(ctx.structuralEvidence) && typeof ctx.structuralEvidence.publicContainerId === 'string'
      ? ctx.structuralEvidence.publicContainerId
      : null);

  let recovery = buildSupportPlaybook({
    errorCode: ctx.errorCode,
    outcomeKind: ctx.outcomeKind,
    setupRunId: ctx.setupRunId,
    businessId: ctx.businessId,
    publicContainerId,
  });

  if (!recovery) {
    const legacy = buildRecovery(ctx.outcomeKind, ctx.structuralEvidence);
    if (legacy) {
      recovery = {
        title: legacy.title,
        steps: legacy.steps.map((text) => ({ text })),
      };
    }
  }

  const conversionRecovery = ctx.conversionActions
    ? buildConversionActionRecovery(ctx.conversionActions)
    : null;
  if (conversionRecovery) {
    recovery = {
      title: conversionRecovery.title,
      steps: conversionRecovery.steps.map((text) => ({ text })),
    };
  }

  if (ctx.stuckState?.stuck && ctx.outcomeKind === 'in_progress') {
    recovery = {
      title: 'Setup appears stuck',
      steps: [
        { text: ctx.stuckState.guidance ?? 'Verify the Temporal worker is running.' },
        { text: 'Refresh this page after confirming the worker and MongoDB are healthy.' },
        {
          text: 'If the issue persists, inspect the workflow in Temporal UI and start a new setup run if needed.',
        },
      ],
      advancedSteps: recovery?.advancedSteps,
    };
  } else if (ctx.compensation?.actions?.length) {
    const compensationSteps = ctx.compensation.actions
      .map((action) => {
        if (action.type === 'ads_campaign_pause' && action.outcome === 'paused') {
          return { text: 'A partially created Google Ads campaign was paused automatically.' };
        }
        if (action.type === 'gtm_manual_review_guidance' && typeof action.message === 'string') {
          return { text: action.message };
        }
        if (
          (action.type === 'gtm_provisioning_failure_guidance' ||
            action.type === 'ads_provisioning_failure_guidance') &&
          typeof action.message === 'string'
        ) {
          return { text: action.message };
        }
        return null;
      })
      .filter(Boolean);
    if (compensationSteps.length > 0) {
      recovery = {
        title: recovery?.title ?? 'Partial setup requires review',
        steps: [...(recovery?.steps ?? []), ...compensationSteps],
        advancedSteps: recovery?.advancedSteps,
      };
    }
  }

  return normalizeRecovery(recovery);
}

function normalizeAdsCatalog(meta, steps) {
  const catalogStep = findStep(steps, SETUP_STEP_NAMES.ADS_CONVERSION_CATALOG);
  const ready = catalogStep?.status === 'success' || metaValue(meta, 'catalog') === 'ready';

  const summary =
    (isObject(metaValue(meta, 'catalogSummary')) ? metaValue(meta, 'catalogSummary') : null) ??
    stepSummary(catalogStep);

  return {
    status: ready ? 'ready' : 'not_run',
    summary: isObject(summary) ? summary : null,
  };
}

/**
 * @param {object | null | undefined} meta
 * @param {object[]} steps
 */
function normalizeGtmSetup(meta, steps) {
  const gtmStep = findStep(steps, SETUP_STEP_NAMES.GTM_CONVERSION_SETUP);
  const complete = gtmStep?.status === 'success' || metaValue(meta, 'gtm') === 'setup_complete';

  const summary =
    (isObject(metaValue(meta, 'gtmSummary')) ? metaValue(meta, 'gtmSummary') : null) ??
    stepSummary(gtmStep);

  return {
    status: complete ? 'setup_complete' : 'not_run',
    summary: isObject(summary) ? summary : null,
  };
}

/**
 * @param {object | null | undefined} meta
 * @param {object[]} steps
 * @param {string} setupRunStatus
 */
function normalizeProvisioning(meta, steps, setupRunStatus) {
  const gtmStep = findStep(steps, SETUP_STEP_NAMES.PROVISION_GTM_RESOURCES);
  const adsStep = findStep(steps, SETUP_STEP_NAMES.PROVISION_GOOGLE_ADS_CUSTOMER);

  const gtmMeta = metaValue(meta, 'gtmProvisioning');
  const adsMeta = metaValue(meta, 'googleAdsProvisioning');

  let gtmStatus = 'not_required';
  if (setupRunStatus === 'GTM_PROVISIONING_REQUIRED') gtmStatus = 'approval_required';
  else if (gtmMeta === 'provisioned' || gtmStep?.status === 'success') gtmStatus = 'provisioned';
  else if (gtmStep?.status === 'failed') gtmStatus = 'failed';

  let adsStatus = 'not_required';
  if (setupRunStatus === 'ADS_PROVISIONING_REQUIRED') adsStatus = 'approval_required';
  else if (adsMeta === 'provisioned' || adsStep?.status === 'success') adsStatus = 'provisioned';
  else if (adsStep?.status === 'failed') adsStatus = 'failed';

  return {
    gtm: { status: gtmStatus, requestId: metaValue(meta, 'gtmProvisioningRequestId') ?? null },
    googleAds: {
      status: adsStatus,
      requestId: metaValue(meta, 'googleAdsProvisioningRequestId') ?? null,
    },
  };
}

/**
 * @param {object | null | undefined} meta
 * @param {object[]} steps
 * @param {string} setupRunStatus
 */
function normalizeStructuralVerification(meta, steps, setupRunStatus) {
  const verifyStep = findStep(steps, SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION);
  const evidence =
    (isObject(metaValue(meta, 'structuralVerification'))
      ? metaValue(meta, 'structuralVerification')
      : null) ??
    (isObject(verifyStep?.details?.evidence) ? verifyStep.details.evidence : null);

  const summaryText =
    typeof metaValue(meta, 'structuralVerificationSummary') === 'string'
      ? metaValue(meta, 'structuralVerificationSummary')
      : typeof verifyStep?.lastErrorSummary === 'string'
        ? verifyStep.lastErrorSummary
        : null;

  let status = 'not_run';
  if (verifyStep?.status === 'success') status = 'pass';
  else if (verifyStep?.status === 'skipped') status = 'skipped';
  else if (setupRunStatus === 'SUCCEEDED' && isObject(evidence)) {
    const missing = Array.isArray(evidence.missing) ? evidence.missing : [];
    if (missing.length === 0 && evidence.snippetPresent !== false) status = 'pass';
  } else if (setupRunStatus === 'GTM_SNIPPET_PENDING') status = 'snippet_pending';
  else if (setupRunStatus === 'SETUP_NEEDS_TRACKING_FIX') status = 'needs_tracking_fix';
  else if (setupRunStatus === 'SETUP_NEEDS_MANUAL_REVIEW') status = 'manual_review';
  else if (verifyStep?.status === 'failed') {
    if (verifyStep.details?.snippetPending === true) status = 'snippet_pending';
    else status = 'needs_tracking_fix';
  }

  return {
    status,
    summary: summaryText,
    evidence: isObject(evidence) ? evidence : null,
  };
}

/** @type {Record<string, string>} */
const ADS_BUCKET_LABELS = {
  campaign: 'Bucket 1: Campaign',
  ad_group: 'Bucket 2: Ad Group',
  ad: 'Bucket 2: Ads',
  keywords: 'Bucket 3: Keywords',
  geo: 'Bucket 3: Geo Targeting',
  conversions: 'Bucket 3: Conversion Goal Linking',
};

/**
 * @param {{ validationBucket?: string | null, code?: string | null, field?: string | null }} input
 * @returns {string}
 */
function recommendedActionForAdsFailure({ validationBucket, code, field }) {
  void code;
  void field;
  if (validationBucket === 'keywords') {
    return 'Remove unsupported symbols or adjust business/service wording.';
  }
  if (validationBucket === 'geo') {
    return 'Use a clearer city, region, or service area name.';
  }
  if (validationBucket === 'ad' || validationBucket === 'ad_group') {
    return 'Review ad headlines, descriptions, and final URL requirements.';
  }
  if (validationBucket === 'campaign') {
    return 'Review campaign budget, bidding, status, and network settings.';
  }
  if (validationBucket === 'conversions') {
    return 'Select or create at least one valid Google Ads conversion action.';
  }
  return 'Review the highlighted campaign setup field and try again.';
}

/**
 * @param {string | null | undefined} validationBucket
 * @returns {string | null}
 */
function adsBucketLabel(validationBucket) {
  if (typeof validationBucket !== 'string' || !validationBucket.trim()) return null;
  return ADS_BUCKET_LABELS[validationBucket] ?? null;
}

/**
 * @param {object | null | undefined} step
 */
function buildAdsCampaignFailureFromStep(step) {
  if (!step || step.status !== 'failed') return null;

  const details = isObject(step.details) ? step.details : {};
  const issues = Array.isArray(details.issues) ? details.issues : [];
  const firstIssue = issues.length > 0 && isObject(issues[0]) ? issues[0] : null;

  const validationBucket =
    (typeof details.validationBucket === 'string' && details.validationBucket.trim()
      ? details.validationBucket.trim()
      : null) ??
    (typeof firstIssue?.bucket === 'string' && firstIssue.bucket.trim() ? firstIssue.bucket.trim() : null);

  const field =
    (typeof details.field === 'string' && details.field.trim() ? details.field.trim() : null) ??
    (typeof firstIssue?.field === 'string' && firstIssue.field.trim() ? firstIssue.field.trim() : null);

  const code =
    (typeof details.code === 'string' && details.code.trim() ? details.code.trim() : null) ??
    (typeof firstIssue?.code === 'string' && firstIssue.code.trim() ? firstIssue.code.trim() : null);

  const message = resolveSetupUserErrorMessage({
    errorCode: code,
    fallbackMessage:
      (typeof details.message === 'string' && details.message.trim() ? details.message.trim() : null) ??
      (typeof step.lastErrorSummary === 'string' && step.lastErrorSummary.trim()
        ? step.lastErrorSummary.trim()
        : 'Google Ads campaign creation failed.'),
  });

  const provider =
    details.provider === 'google_ads' || step.provider === 'google_ads' ? 'google_ads' : 'google_ads';

  const stepName =
    typeof details.stepName === 'string' && details.stepName.trim()
      ? details.stepName.trim()
      : typeof step.stepName === 'string'
        ? step.stepName
        : SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION;

  return {
    provider,
    stepName,
    validationBucket,
    bucketLabel: adsBucketLabel(validationBucket),
    field,
    code,
    message,
    recommendedAction: recommendedActionForAdsFailure({ validationBucket, code, field }),
    issues: issues.filter((row) => isObject(row)),
  };
}

/**
 * @param {object | null | undefined} meta
 * @param {object[]} steps
 * @param {object | null} campaignPlan
 */
function normalizeAdsCampaign(meta, steps, campaignPlan) {
  const adsStep = findStep(steps, SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION);
  const failure = buildAdsCampaignFailureFromStep(adsStep);
  const recorded = adsStep?.status === 'success' || metaValue(meta, 'ads') === 'campaigns_recorded';

  const summary =
    (isObject(metaValue(meta, 'adsCampaignSummary')) ? metaValue(meta, 'adsCampaignSummary') : null) ??
    stepSummary(adsStep);

  let plan = null;
  if (campaignPlan && isObject(campaignPlan.intent)) {
    const intent = campaignPlan.intent;
    plan = {
      campaignName: typeof intent.campaignName === 'string' ? intent.campaignName : null,
      bidding: typeof intent.bidding === 'string' ? intent.bidding : null,
      budgetAmountMicros:
        isObject(intent.budget) && typeof intent.budget.amountMicros === 'number'
          ? intent.budget.amountMicros
          : null,
    };
  }

  let status = 'not_run';
  if (recorded) status = 'campaigns_recorded';
  else if (failure) status = 'failed';

  return {
    status,
    summary: isObject(summary) ? summary : null,
    plan,
    failure,
  };
}

/**
 * @param {import('mongoose').Types.ObjectId} setupRunId
 * @param {import('mongoose').Types.ObjectId} businessId
 */
async function countArtifacts(setupRunId, businessId) {
  const rows = await IntegrationArtifact.aggregate([
    { $match: { setupRunId, businessId } },
    { $group: { _id: '$artifactType', count: { $sum: 1 } } },
  ]);

  /** @type {Record<string, number>} */
  const byType = {};
  for (const row of rows) {
    byType[row._id] = row.count;
  }

  return {
    gtmTags: byType.gtm_tag ?? 0,
    gtmTriggers: byType.gtm_trigger ?? 0,
    gtmVariables: byType.gtm_variable ?? 0,
    adsConversions: byType.ads_conversion_action ?? 0,
    adsCampaignBudgets: byType.ads_campaign_budget ?? 0,
    adsCampaigns: byType.ads_campaign ?? 0,
    adsAdGroups: byType.ads_ad_group ?? 0,
    adsAds: byType.ads_ad ?? 0,
    adsConversionLinks: byType.ads_conversion_link ?? 0,
  };
}

/**
 * Post-setup tracking recommendations (non-blocking; shown after Ads launch).
 *
 * @param {object | null | undefined} meta
 * @param {object[]} steps
 * @param {object} structuralVerification
 * @param {object} gtmSetup
 * @param {string} setupRunStatus
 * @param {object} adsCampaign
 */
function buildRecommendations(meta, steps, structuralVerification, gtmSetup, setupRunStatus, adsCampaign) {
  if (setupRunStatus !== 'SUCCEEDED' || adsCampaign.status !== 'campaigns_recorded') {
    return [];
  }

  /** @type {Array<{ id: string, priority: string, title: string, message: string, steps: string[] }>} */
  const items = [];
  const verifyStep = findStep(steps, SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION);
  const gtmOptional =
    structuralVerification.status === 'skipped' ||
    Boolean(structuralVerification.evidence?.gtmOptional) ||
    verifyStep?.status === 'skipped';

  if (gtmOptional || gtmSetup.status === 'not_run') {
    items.push({
      id: 'connect_gtm',
      priority: 'recommended',
      title: 'Set up Google Tag Manager tracking',
      message:
        'Your Google Ads campaign was created paused and is ready to enable in Google Ads. Connect Google Tag Manager next so Zuggernaut can measure website conversions accurately.',
      steps: [
        'Open the setup page and connect Google Tag Manager.',
        'Select or provision a GTM container and workspace.',
        'Install the GTM snippet on your website when you are ready.',
      ],
    });
  }

  const publicContainerId =
    typeof structuralVerification.evidence?.publicContainerId === 'string'
      ? structuralVerification.evidence.publicContainerId
      : null;

  if (
    structuralVerification.status === 'snippet_pending' ||
    structuralVerification.evidence?.snippetPresent === false
  ) {
    items.push({
      id: 'install_gtm_snippet',
      priority: 'recommended',
      title: 'Install the GTM snippet on your website',
      message:
        'GTM is connected but the container snippet was not detected on your site. Install it to start recording conversions.',
      steps: [
        publicContainerId
          ? `Add the GTM container snippet for ${publicContainerId} to the <head> of every page.`
          : 'Add your GTM container snippet to the <head> of every page on your website.',
        'Publish your GTM container after tags are in place.',
        'Return to Zuggernaut to verify tracking health when the snippet is live.',
      ],
    });
  }

  if (structuralVerification.status === 'needs_tracking_fix') {
    const missing = Array.isArray(structuralVerification.evidence?.missing)
      ? structuralVerification.evidence.missing
      : [];
    items.push({
      id: 'complete_tracking_setup',
      priority: 'recommended',
      title: 'Complete conversion tracking setup',
      message:
        'Your campaign was created paused and is ready to enable in Google Ads, but some tracking elements still need attention for reliable conversion measurement.',
      steps: [
        missing.length > 0
          ? `Resolve: ${missing.map((m) => m.replace(/_/g, ' ')).join(', ')}.`
          : 'Review GTM tags and triggers linked to your Google Ads conversion actions.',
        'Publish the GTM container after changes.',
        'Use Zuggernaut tracking health checks once updates are live.',
      ],
    });
  }

  if (typeof metaValue(meta, 'gtmNudgeReason') === 'string' && !gtmOptional) {
    items.push({
      id: 'connect_gtm_nudge',
      priority: 'optional',
      title: 'Improve conversion measurement with GTM',
      message: 'Google Tag Manager is optional for launch but recommended for accurate on-site conversion tracking.',
      steps: [
        'Connect GTM from the setup page when you are ready.',
        'Let Zuggernaut configure conversion tags automatically.',
        'Install the snippet on your website to complete tracking.',
      ],
    });
  }

  return items;
}

/**
 * @param {import('mongoose').Types.ObjectId} setupRunId
 * @returns {Promise<object | null>}
 */
async function buildSetupRunReport(setupRunId) {
  const setupRun = await SetupRun.findById(setupRunId).lean();
  if (!setupRun) return null;

  const businessId = setupRun.businessId;

  const [businessContext, stepsRaw, auditReport, campaignPlan, artifactCounts] = await Promise.all([
    BusinessContext.findOne({ businessId }).lean(),
    SetupStepExecution.find({ setupRunId }).sort({ stepName: 1 }).lean(),
    AuditReport.findOne({ setupRunId, businessId }).lean(),
    CampaignPlan.findOne({ setupRunId }).lean(),
    countArtifacts(setupRunId, businessId),
  ]);

  const steps = stepsRaw.map((s) => ({
    id: s._id.toString(),
    stepName: s.stepName,
    provider: s.provider ?? null,
    status: s.status,
    attemptCount: s.attemptCount,
    startedAt: s.startedAt ?? null,
    endedAt: s.endedAt ?? null,
    lastErrorSummary: sanitizeStepErrorSummary(s),
    details: s.details ?? null,
    updatedAt: s.updatedAt,
  }));

  const meta = setupRun.meta ?? null;
  const supportStateRaw = isObject(metaValue(meta, 'supportState')) ? metaValue(meta, 'supportState') : null;
  const supportErrorCode =
    supportStateRaw && typeof supportStateRaw.errorCode === 'string'
      ? supportStateRaw.errorCode
      : null;
  const sanitizedRunErrorSummary = sanitizeSetupErrorSummary(
    setupRun.lastErrorSummary,
    supportErrorCode
  );
  const gbpAudit = normalizeGbpAudit(meta, steps);
  const adsCatalog = normalizeAdsCatalog(meta, steps);
  const conversionActions = normalizeConversionActions(
    meta,
    steps,
    setupRun.status,
    sanitizedRunErrorSummary
  );
  const gtmSetup = normalizeGtmSetup(meta, steps);
  const provisioning = normalizeProvisioning(meta, steps, setupRun.status);
  const structuralVerification = normalizeStructuralVerification(meta, steps, setupRun.status);
  const adsCampaign = normalizeAdsCampaign(meta, steps, campaignPlan);
  const recommendations = buildRecommendations(
    meta,
    steps,
    structuralVerification,
    gtmSetup,
    setupRun.status,
    adsCampaign
  );

  if (auditReport?.findings && (gbpAudit.status === 'complete' || gbpAudit.status === 'guidance')) {
    gbpAudit.findings = {
      present: auditReport.findings.present ?? [],
      missing: auditReport.findings.missing ?? [],
      needsAttention: auditReport.findings.needsAttention ?? [],
    };
  } else {
    gbpAudit.findings = null;
  }

  const outcomeKind = mapOutcomeKind(setupRun.status);
  const stuckState = detectStuckSetupRun(setupRun);
  const compensation = existingCompensation(meta);
  const supportState = supportStateRaw;
  const recovery = resolveSetupRecovery({
    errorCode: supportErrorCode,
    outcomeKind,
    setupRunId: setupRun._id.toString(),
    businessId: businessId.toString(),
    structuralEvidence: structuralVerification.evidence,
    stuckState,
    compensation,
    conversionActions,
  });

  return {
    setupRun: {
      id: setupRun._id.toString(),
      businessId: businessId.toString(),
      temporalWorkflowId: setupRun.temporalWorkflowId ?? null,
      status: setupRun.status,
      lastErrorSummary: sanitizedRunErrorSummary,
      createdAt: setupRun.createdAt,
      updatedAt: setupRun.updatedAt,
    },
    business: businessContext
      ? {
          businessName: businessContext.businessName ?? null,
          websiteUrl: businessContext.websiteUrl ?? null,
          goals: businessContext.goals ?? null,
        }
      : null,
    outcome: {
      kind: outcomeKind,
      headline: outcomeHeadline(outcomeKind, sanitizedRunErrorSummary, supportErrorCode),
      recovery,
    },
    stuckState,
    supportState,
    compensation,
    gbpAudit,
    conversionActions,
    adsCatalog,
    gtmSetup,
    provisioning,
    structuralVerification,
    adsCampaign,
    recommendations,
    artifactCounts,
    steps,
  };
}

module.exports = {
  buildSetupRunReport,
  mapOutcomeKind,
  normalizeGbpAudit,
  normalizeConversionActions,
  normalizeAdsCatalog,
  normalizeGtmSetup,
  normalizeProvisioning,
  normalizeStructuralVerification,
  normalizeAdsCampaign,
  buildAdsCampaignFailureFromStep,
  recommendedActionForAdsFailure,
  ADS_BUCKET_LABELS,
  buildRecovery,
  resolveSetupRecovery,
};
