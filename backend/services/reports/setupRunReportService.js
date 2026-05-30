'use strict';

const mongoose = require('mongoose');
const { SETUP_STEP_NAMES } = require('../../constants/setupWorkflow');
const { detectStuckSetupRun } = require('../setupRunStuckDetection');
const { existingCompensation } = require('../compensation/setupRunCompensationService');
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
function outcomeHeadline(kind, lastErrorSummary) {
  switch (kind) {
    case 'succeeded':
      return 'Setup completed successfully.';
    case 'failed':
      return lastErrorSummary ?? 'Setup failed.';
    case 'snippet_pending':
      return 'GTM snippet must be installed before Ads campaign creation can continue.';
    case 'provisioning_required':
      return lastErrorSummary ?? 'Provisioning approval is required before setup can continue.';
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

/**
 * @param {object | null | undefined} meta
 * @param {object[]} steps
 * @param {object | null} campaignPlan
 */
function normalizeAdsCampaign(meta, steps, campaignPlan) {
  const adsStep = findStep(steps, SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION);
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

  return {
    status: recorded ? 'campaigns_recorded' : 'not_run',
    summary: isObject(summary) ? summary : null,
    plan,
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
    lastErrorSummary: s.lastErrorSummary ?? null,
    details: s.details ?? null,
    updatedAt: s.updatedAt,
  }));

  const meta = setupRun.meta ?? null;
  const gbpAudit = normalizeGbpAudit(meta, steps);
  const adsCatalog = normalizeAdsCatalog(meta, steps);
  const gtmSetup = normalizeGtmSetup(meta, steps);
  const provisioning = normalizeProvisioning(meta, steps, setupRun.status);
  const structuralVerification = normalizeStructuralVerification(meta, steps, setupRun.status);
  const adsCampaign = normalizeAdsCampaign(meta, steps, campaignPlan);

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
  const supportState = isObject(metaValue(meta, 'supportState')) ? metaValue(meta, 'supportState') : null;
  let recovery = buildRecovery(outcomeKind, structuralVerification.evidence);

  if (stuckState.stuck && outcomeKind === 'in_progress') {
    recovery = {
      title: 'Setup appears stuck',
      steps: [
        stuckState.guidance ?? 'Verify the Temporal worker is running.',
        'Refresh this page after confirming the worker and MongoDB are healthy.',
        'If the issue persists, inspect the workflow in Temporal UI and start a new setup run if needed.',
      ],
    };
  } else if (compensation?.actions?.length) {
    const compensationSteps = compensation.actions
      .map((action) => {
        if (action.type === 'ads_campaign_pause' && action.outcome === 'paused') {
          return 'A partially created Google Ads campaign was paused automatically.';
        }
        if (action.type === 'gtm_manual_review_guidance' && typeof action.message === 'string') {
          return action.message;
        }
        if (
          (action.type === 'gtm_provisioning_failure_guidance' ||
            action.type === 'ads_provisioning_failure_guidance') &&
          typeof action.message === 'string'
        ) {
          return action.message;
        }
        return null;
      })
      .filter(Boolean);
    if (compensationSteps.length > 0) {
      recovery = {
        title: recovery?.title ?? 'Partial setup requires review',
        steps: [...(recovery?.steps ?? []), ...compensationSteps],
      };
    }
  }

  return {
    setupRun: {
      id: setupRun._id.toString(),
      businessId: businessId.toString(),
      temporalWorkflowId: setupRun.temporalWorkflowId ?? null,
      status: setupRun.status,
      lastErrorSummary: setupRun.lastErrorSummary ?? null,
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
      headline: outcomeHeadline(outcomeKind, setupRun.lastErrorSummary),
      recovery,
    },
    stuckState,
    supportState,
    compensation,
    gbpAudit,
    adsCatalog,
    gtmSetup,
    provisioning,
    structuralVerification,
    adsCampaign,
    artifactCounts,
    steps,
  };
}

module.exports = {
  buildSetupRunReport,
  mapOutcomeKind,
  normalizeGbpAudit,
  normalizeAdsCatalog,
  normalizeGtmSetup,
  normalizeProvisioning,
  normalizeStructuralVerification,
  normalizeAdsCampaign,
  buildRecovery,
};
