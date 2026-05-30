'use strict';

const mongoose = require('mongoose');
const { ApplicationFailure } = require('@temporalio/activity');
const { createLogger } = require('../lib/observability/logger');
const { SETUP_STEP_NAMES, SETUP_RUN_PATCH_STATUS: S } = require('../constants/setupWorkflow');
const SetupRun = mongoose.model('SetupRun');
const BusinessContext = mongoose.model('BusinessContext');
const {
  markStepRunning,
  markStepSuccess,
  markStepFailed,
  markStepSkipped,
  patchSetupRun,
  mergeSetupRunMeta,
} = require('./lib/setupLifecycle');
const { parseSetupActivityIds, safeErrorMessage } = require('./lib/setupActivityInput');
const { recordSetupFailureSupport } = require('./lib/setupFailureSupport');
const {
  getConnectionStatus,
  getAllConnectionStatuses,
  getRequiredSetupConnections,
  CONNECTION_REASON,
} = require('../services/capabilities/integrationConnectionService');
const {
  runGbpReadOnlyAudit,
  fetchAndPersistConversionCatalog,
  AdsCatalogPreconditionError,
  runGtmConversionSetup,
  GtmProviderPreconditionError,
  runStructuralVerification,
  createAdsAutoCampaign,
  AdsProviderPreconditionError,
  ensureSetupProvisioningRequest,
  checkSetupProvisioningApproval,
  executeProvisioningRequest,
  ProvisioningServiceError,
  GtmProvisioningError,
  AdsProvisioningError,
} = require('../services/capabilities');

async function blockSetupForMissingProviders({
  setupRunId,
  businessId,
  stepName,
  missing,
  logger,
}) {
  const msg = `Connect integrations before setup can continue: ${missing.join(', ')}.`;
  await markStepFailed({
    setupRunId,
    businessId,
    stepName,
    summary: msg,
    details: { missingProviders: missing },
    logger,
  });
  await patchSetupRun(
    setupRunId,
    {
      status: S.SETUP_NEEDS_MANUAL_REVIEW,
      lastErrorSummary: msg,
    },
    logger
  );
  await mergeSetupRunMeta(
    setupRunId,
    { missingProviders: missing, blockedAt: stepName },
    logger
  );
  return {
    outcome: 'manual_review',
    missingProviders: missing,
    setupRunId: setupRunId.toString(),
    businessId: businessId.toString(),
  };
}

/**
 * @param {object} ctx
 */
async function handleProviderProvisioningPrecheck(ctx) {
  const {
    setupRunId,
    businessId,
    rawRun,
    rawBiz,
    provider,
    stepName,
    patchStatus,
    outcomeKey,
    metaKey,
    logger,
  } = ctx;

  const status = await getConnectionStatus(businessId, provider);
  if (status.ready) {
    await markStepSuccess({
      setupRunId,
      businessId,
      stepName,
      provider,
      details: status,
      logger,
    });
    return {
      outcome: 'ok',
      provider,
      ready: true,
      reason: status.reason,
      setupRunId: rawRun,
      businessId: rawBiz,
    };
  }

  if (status.reason === CONNECTION_REASON.PROVISIONING_REQUIRED) {
    const { request } = await ensureSetupProvisioningRequest({
      businessId,
      provider,
      setupRunId,
    });
    const msg = `Approve ${provider} provisioning to continue setup.`;
    await markStepSkipped({
      setupRunId,
      businessId,
      stepName,
      provider,
      details: {
        provisioningRequired: true,
        provisioningRequestId: request.id,
        identifiersMissing: status.identifiersMissing,
        nextAction: status.nextAction,
      },
      logger,
    });
    await patchSetupRun(setupRunId, { status: patchStatus, lastErrorSummary: msg }, logger);
    await mergeSetupRunMeta(
      setupRunId,
      {
        [metaKey]: 'pending_approval',
        provisioningRequestId: request.id,
        identifiersMissing: status.identifiersMissing,
      },
      logger
    );
    return {
      outcome: outcomeKey,
      provider,
      ready: false,
      provisioningRequestId: request.id,
      identifiersMissing: status.identifiersMissing,
      nextAction: status.nextAction,
      setupRunId: rawRun,
      businessId: rawBiz,
    };
  }

  return blockSetupForMissingProviders({
    setupRunId,
    businessId,
    stepName,
    missing: [provider],
    logger,
  });
}

/**
 * @param {{ setupRunId?: string }} input
 */
async function loadSetupContextActivity(input) {
  const logger = createLogger({ name: 'loadSetupContextActivity' });
  const rawId = typeof input?.setupRunId === 'string' ? input.setupRunId.trim() : '';

  if (!rawId || !mongoose.Types.ObjectId.isValid(rawId)) {
    return { outcome: 'invalid', reason: 'Invalid or missing setupRunId', setupRunId: rawId || null };
  }

  const setupRunId = new mongoose.Types.ObjectId(rawId);
  const run = await SetupRun.findById(setupRunId).lean();
  if (!run) {
    return {
      outcome: 'failed',
      reason: 'SetupRun not found',
      setupRunId: rawId,
    };
  }

  const businessId = run.businessId;
  await markStepRunning({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.LOAD_CONTEXT,
    logger,
  });

  const bc = await BusinessContext.findOne({
    businessId,
    confirmedAt: { $ne: null },
  }).lean();

  if (!bc) {
    const msg = 'Confirmed BusinessContext not found for this business.';
    await markStepFailed({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.LOAD_CONTEXT,
      summary: msg,
      logger,
    });
    await patchSetupRun(
      setupRunId,
      { status: S.FAILED, lastErrorSummary: msg },
      logger
    );
    return { outcome: 'failed', reason: msg, setupRunId: rawId, businessId: businessId.toString() };
  }

  const connections = await getAllConnectionStatuses(businessId);

  await markStepSuccess({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.LOAD_CONTEXT,
    details: { websiteUrl: bc.websiteUrl ?? null, connections },
    logger,
  });

  await patchSetupRun(setupRunId, { status: S.RUNNING, lastErrorSummary: null }, logger);

  logger.info(
    {
      setupRunId: rawId,
      businessId: businessId.toString(),
      stepName: SETUP_STEP_NAMES.LOAD_CONTEXT,
    },
    'load setup context completed'
  );

  return {
    outcome: 'ok',
    setupRunId: rawId,
    businessId: businessId.toString(),
    websiteUrl: bc.websiteUrl ?? '',
    goals: bc.goals ?? null,
    businessName: bc.businessName ?? null,
    connections,
  };
}

/**
 * GBP is optional in V1 — record readiness without blocking the workflow.
 * @param {{ setupRunId: string, businessId: string }} input
 */
async function checkGbpPreconditionsActivity(input) {
  const logger = createLogger({ name: 'checkGbpPreconditionsActivity' });
  const { rawRun, rawBiz, setupRunId, businessId } = parseSetupActivityIds(input);

  await markStepRunning({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.CHECK_GBP_CONNECTION,
    provider: 'gbp',
    logger,
  });

  const status = await getConnectionStatus(businessId, 'gbp');
  await markStepSuccess({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.CHECK_GBP_CONNECTION,
    provider: 'gbp',
    details: status,
    logger,
  });

  return {
    outcome: status.ready ? 'ok' : 'not_ready',
    provider: 'gbp',
    ready: status.ready,
    reason: status.reason,
    nextAction: status.nextAction,
    setupRunId: rawRun,
    businessId: rawBiz,
  };
}

/**
 * @param {{ setupRunId: string, businessId: string }} input
 */
async function checkGtmPreconditionsActivity(input) {
  const logger = createLogger({ name: 'checkGtmPreconditionsActivity' });
  const { rawRun, rawBiz, setupRunId, businessId } = parseSetupActivityIds(input);

  await markStepRunning({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.CHECK_GTM_CONNECTION,
    provider: 'gtm',
    logger,
  });

  return handleProviderProvisioningPrecheck({
    setupRunId,
    businessId,
    rawRun,
    rawBiz,
    provider: 'gtm',
    stepName: SETUP_STEP_NAMES.CHECK_GTM_CONNECTION,
    patchStatus: S.GTM_PROVISIONING_REQUIRED,
    outcomeKey: 'gtm_provisioning_required',
    metaKey: 'gtmProvisioning',
    logger,
  });
}

/**
 * @param {{ setupRunId: string, businessId: string }} input
 */
async function checkGoogleAdsPreconditionsActivity(input) {
  const logger = createLogger({ name: 'checkGoogleAdsPreconditionsActivity' });
  const { rawRun, rawBiz, setupRunId, businessId } = parseSetupActivityIds(input);

  await markStepRunning({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.CHECK_GOOGLE_ADS_CONNECTION,
    provider: 'google_ads',
    logger,
  });

  return handleProviderProvisioningPrecheck({
    setupRunId,
    businessId,
    rawRun,
    rawBiz,
    provider: 'google_ads',
    stepName: SETUP_STEP_NAMES.CHECK_GOOGLE_ADS_CONNECTION,
    patchStatus: S.ADS_PROVISIONING_REQUIRED,
    outcomeKey: 'ads_provisioning_required',
    metaKey: 'googleAdsProvisioning',
    logger,
  });
}

/**
 * @deprecated Prefer per-provider checks in workflow; kept for tests that mock a single precondition gate.
 * @param {{ setupRunId: string, businessId: string }} input
 */
async function checkProviderPreconditionsActivity(input) {
  const logger = createLogger({ name: 'checkProviderPreconditionsActivity' });
  const { rawRun, rawBiz, setupRunId, businessId } = parseSetupActivityIds(input);

  await markStepRunning({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.PROVIDER_PRECONDITIONS,
    logger,
  });

  const { missing, allReady } = await getRequiredSetupConnections(businessId);

  if (!allReady) {
    return blockSetupForMissingProviders({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.PROVIDER_PRECONDITIONS,
      missing,
      logger,
    });
  }

  await markStepSuccess({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.PROVIDER_PRECONDITIONS,
    details: { required: ['gtm', 'google_ads'] },
    logger,
  });

  return { outcome: 'ok', setupRunId: rawRun, businessId: rawBiz };
}

/**
 * @param {{ setupRunId: string, businessId: string }} input
 */
async function runGbpAuditActivity(input) {
  const logger = createLogger({ name: 'runGbpAuditActivity' });
  const { rawRun, rawBiz, setupRunId, businessId } = parseSetupActivityIds(input);

  await markStepRunning({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.GBP_AUDIT,
    provider: 'gbp',
    logger,
  });

  const gbpStatus = await getConnectionStatus(businessId, 'gbp');
  if (!gbpStatus.ready) {
    await markStepSkipped({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.GBP_AUDIT,
      provider: 'gbp',
      details: { reason: 'gbp_not_connected' },
      logger,
    });
    await mergeSetupRunMeta(setupRunId, { gbpAudit: 'skipped' }, logger);
    return { outcome: 'skipped', setupRunId: rawRun, businessId: rawBiz };
  }

  try {
    const audit = await runGbpReadOnlyAudit({ setupRunId, businessId, logger });
    if (audit.skipped) {
      await markStepSkipped({
        setupRunId,
        businessId,
        stepName: SETUP_STEP_NAMES.GBP_AUDIT,
        provider: 'gbp',
        details: {
          reason: audit.reason,
          guidance: audit.guidance,
          blocking: false,
        },
        logger,
      });
      await mergeSetupRunMeta(
        setupRunId,
        {
          gbpAudit: 'guidance',
          gbpAuditSummary: audit.summary,
          gbpGuidance: audit.guidance,
        },
        logger
      );
      return {
        outcome: 'skipped',
        setupRunId: rawRun,
        businessId: rawBiz,
        reason: audit.reason,
        guidance: audit.guidance,
        blocking: false,
      };
    }
    await markStepSuccess({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.GBP_AUDIT,
      provider: 'gbp',
      details: { summary: audit.summary, source: audit.source },
      logger,
    });
    await mergeSetupRunMeta(
      setupRunId,
      { gbpAudit: 'complete', gbpAuditSummary: audit.summary },
      logger
    );
    return { outcome: 'ok', setupRunId: rawRun, businessId: rawBiz, summary: audit.summary };
  } catch (err) {
    const msg = safeErrorMessage(err, 'GBP audit failed');
    await markStepFailed({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.GBP_AUDIT,
      provider: 'gbp',
      summary: msg,
      logger,
    });
    await patchSetupRun(setupRunId, { status: S.FAILED, lastErrorSummary: msg }, logger);
    throw ApplicationFailure.nonRetryable(msg, 'GbpAuditError');
  }
}

/**
 * @param {{ setupRunId: string, businessId: string }} input
 */
async function fetchAdsConversionCatalogActivity(input) {
  const logger = createLogger({ name: 'fetchAdsConversionCatalogActivity' });
  const { rawRun, rawBiz, setupRunId, businessId } = parseSetupActivityIds(input);

  await markStepRunning({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.ADS_CONVERSION_CATALOG,
    provider: 'google_ads',
    logger,
  });

  try {
    const catalog = await fetchAndPersistConversionCatalog({ setupRunId, businessId, logger });
    await markStepSuccess({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.ADS_CONVERSION_CATALOG,
      provider: 'google_ads',
      details: { summary: catalog.summary, selectedIds: catalog.selectedIds, source: catalog.source },
      logger,
    });
    await mergeSetupRunMeta(
      setupRunId,
      { catalog: 'ready', catalogSummary: catalog.summary },
      logger
    );
    return {
      outcome: 'ok',
      setupRunId: rawRun,
      businessId: rawBiz,
      summary: catalog.summary,
      selectedIds: catalog.selectedIds,
    };
  } catch (err) {
    const msg = safeErrorMessage(err, 'Ads catalog failed');
    await markStepFailed({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.ADS_CONVERSION_CATALOG,
      provider: 'google_ads',
      summary: msg,
      details: err instanceof AdsCatalogPreconditionError ? { code: err.code } : undefined,
      logger,
    });
    await patchSetupRun(setupRunId, { status: S.FAILED, lastErrorSummary: msg }, logger);
    throw ApplicationFailure.nonRetryable(
      msg,
      err instanceof AdsCatalogPreconditionError ? err.code : 'AdsCatalogError'
    );
  }
}

/**
 * @param {{ setupRunId: string, businessId: string }} input
 */
async function runGtmConversionSetupActivity(input) {
  const logger = createLogger({ name: 'runGtmConversionSetupActivity' });
  const { rawRun, rawBiz, setupRunId, businessId } = parseSetupActivityIds(input);

  await markStepRunning({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.GTM_CONVERSION_SETUP,
    provider: 'gtm',
    logger,
  });

  try {
    const result = await runGtmConversionSetup({ setupRunId, businessId, logger });
    await markStepSuccess({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.GTM_CONVERSION_SETUP,
      provider: 'gtm',
      details: { summary: result.summary, source: result.source },
      logger,
    });
    await mergeSetupRunMeta(
      setupRunId,
      { gtm: 'setup_complete', gtmSummary: result.summary },
      logger
    );
    return { outcome: 'ok', setupRunId: rawRun, businessId: rawBiz, summary: result.summary };
  } catch (err) {
    const msg = safeErrorMessage(err, 'GTM setup failed');
    const code = err instanceof GtmProviderPreconditionError ? err.code : 'GtmSetupError';
    await markStepFailed({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.GTM_CONVERSION_SETUP,
      provider: 'gtm',
      summary: msg,
      details: err instanceof GtmProviderPreconditionError ? { code: err.code } : undefined,
      logger,
    });
    await recordSetupFailureSupport({
      setupRunId,
      businessId,
      failedStep: SETUP_STEP_NAMES.GTM_CONVERSION_SETUP,
      errorCode: code,
      logger,
    });
    await patchSetupRun(setupRunId, { status: S.FAILED, lastErrorSummary: msg }, logger);
    throw ApplicationFailure.nonRetryable(msg, code);
  }
}

/**
 * @param {{ setupRunId: string, businessId: string }} input
 */
async function runStructuralVerificationActivity(input) {
  const logger = createLogger({ name: 'runStructuralVerificationActivity' });
  const { rawRun, rawBiz, setupRunId, businessId } = parseSetupActivityIds(input);

  await markStepRunning({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
    provider: 'gtm',
    logger,
  });

  let verdict;
  try {
    verdict = await runStructuralVerification({ setupRunId, businessId, logger });
  } catch (err) {
    const msg = safeErrorMessage(err, 'Verification failed');
    await markStepFailed({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
      provider: 'gtm',
      summary: msg,
      logger,
    });
    await patchSetupRun(setupRunId, { status: S.FAILED, lastErrorSummary: msg }, logger);
    throw ApplicationFailure.nonRetryable(msg, 'StructuralVerificationError');
  }

  if (verdict.result === 'pass') {
    await markStepSuccess({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
      provider: 'gtm',
      details: { evidence: verdict.evidence, summary: verdict.summary },
      logger,
    });
    await mergeSetupRunMeta(
      setupRunId,
      { structuralVerification: verdict.evidence, structuralVerificationSummary: verdict.summary },
      logger
    );
    await patchSetupRun(setupRunId, { lastErrorSummary: null }, logger);
    return { outcome: 'pass', setupRunId: rawRun, businessId: rawBiz, detail: verdict };
  }

  if (verdict.result === 'snippet_pending') {
    await markStepFailed({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
      provider: 'gtm',
      summary: verdict.summary,
      details: { evidence: verdict.evidence, summary: verdict.summary, snippetPending: true },
      logger,
    });
    await mergeSetupRunMeta(
      setupRunId,
      { structuralVerification: verdict.evidence, structuralVerificationSummary: verdict.summary },
      logger
    );
    await patchSetupRun(
      setupRunId,
      {
        status: S.GTM_SNIPPET_PENDING,
        lastErrorSummary: verdict.summary,
      },
      logger
    );
    return { outcome: 'snippet_pending', setupRunId: rawRun, businessId: rawBiz, detail: verdict };
  }

  if (verdict.result === 'needs_tracking_fix') {
    await markStepFailed({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
      provider: 'gtm',
      summary: verdict.summary,
      details: { evidence: verdict.evidence, summary: verdict.summary },
      logger,
    });
    await mergeSetupRunMeta(
      setupRunId,
      { structuralVerification: verdict.evidence, structuralVerificationSummary: verdict.summary },
      logger
    );
    await patchSetupRun(
      setupRunId,
      {
        status: S.SETUP_NEEDS_TRACKING_FIX,
        lastErrorSummary: verdict.summary,
      },
      logger
    );
    return { outcome: 'needs_tracking_fix', setupRunId: rawRun, businessId: rawBiz, detail: verdict };
  }

  await markStepFailed({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
    provider: 'gtm',
    summary: verdict.summary,
    details: { evidence: verdict.evidence, summary: verdict.summary, manualReview: true },
    logger,
  });
  await mergeSetupRunMeta(
    setupRunId,
    { structuralVerification: verdict.evidence, structuralVerificationSummary: verdict.summary },
    logger
  );
  await patchSetupRun(
    setupRunId,
    {
      status: S.SETUP_NEEDS_MANUAL_REVIEW,
      lastErrorSummary: verdict.summary,
    },
    logger
  );
  return { outcome: 'manual_review', setupRunId: rawRun, businessId: rawBiz, detail: verdict };
}

/**
 * @param {{ setupRunId: string, businessId: string }} input
 */
async function createAdsCampaignActivity(input) {
  const logger = createLogger({ name: 'createAdsCampaignActivity' });
  const { rawRun, rawBiz, setupRunId, businessId } = parseSetupActivityIds(input);

  await markStepRunning({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
    provider: 'google_ads',
    logger,
  });

  try {
    const result = await createAdsAutoCampaign({ setupRunId, businessId, logger });
    await markStepSuccess({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
      provider: 'google_ads',
      details: { summary: result.summary, source: result.source, idempotent: result.idempotent },
      logger,
    });
    await mergeSetupRunMeta(
      setupRunId,
      { phase: 'complete', ads: 'campaigns_recorded', adsCampaignSummary: result.summary },
      logger
    );
    await patchSetupRun(setupRunId, { status: S.SUCCEEDED, lastErrorSummary: null }, logger);

    return {
      outcome: 'ok',
      setupRunId: rawRun,
      businessId: rawBiz,
      summary: result.summary,
      idempotent: result.idempotent,
    };
  } catch (err) {
    const msg = safeErrorMessage(err, 'Ads campaign creation failed');
    const code = err instanceof AdsProviderPreconditionError ? err.code : 'AdsCampaignError';
    await markStepFailed({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
      provider: 'google_ads',
      summary: msg,
      details: err instanceof AdsProviderPreconditionError ? { code: err.code } : undefined,
      logger,
    });
    await recordSetupFailureSupport({
      setupRunId,
      businessId,
      failedStep: SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
      errorCode: code,
      logger,
    });
    await patchSetupRun(setupRunId, { status: S.FAILED, lastErrorSummary: msg }, logger);
    throw ApplicationFailure.nonRetryable(msg, code);
  }
}

/**
 * @param {{ setupRunId: string, businessId: string, provider: 'gtm' | 'google_ads' }} input
 */
async function checkProvisioningApprovalActivity(input) {
  const logger = createLogger({ name: 'checkProvisioningApprovalActivity' });
  const { rawRun, rawBiz, setupRunId, businessId } = parseSetupActivityIds(input);
  const provider = input.provider;

  await markStepRunning({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.CHECK_PROVISIONING_APPROVAL,
    provider,
    logger,
  });

  const check = await checkSetupProvisioningApproval({ businessId, provider });

  if (check.outcome === 'ready') {
    await markStepSuccess({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.CHECK_PROVISIONING_APPROVAL,
      provider,
      details: { outcome: check.outcome, requestId: check.request?.id ?? null },
      logger,
    });
    return {
      outcome: 'ready',
      provider,
      provisioningRequestId: check.provisioningRequestId,
      setupRunId: rawRun,
      businessId: rawBiz,
    };
  }

  if (check.outcome === 'pending_approval') {
    await markStepSkipped({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.CHECK_PROVISIONING_APPROVAL,
      provider,
      details: {
        outcome: check.outcome,
        provisioningRequestId: check.provisioningRequestId,
        requestStatus: check.request?.status ?? null,
      },
      logger,
    });
    return {
      outcome: 'pending_approval',
      provider,
      provisioningRequestId: check.provisioningRequestId,
      setupRunId: rawRun,
      businessId: rawBiz,
    };
  }

  if (check.outcome === 'approved') {
    await markStepSuccess({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.CHECK_PROVISIONING_APPROVAL,
      provider,
      details: {
        outcome: check.outcome,
        provisioningRequestId: check.provisioningRequestId,
      },
      logger,
    });
    return {
      outcome: 'approved',
      provider,
      provisioningRequestId: check.provisioningRequestId,
      setupRunId: rawRun,
      businessId: rawBiz,
    };
  }

  const msg =
    check.outcome === 'terminal_failure'
      ? `${provider} provisioning request is ${check.request?.status ?? 'unavailable'}.`
      : `${provider} provisioning approval is not available (${check.outcome}).`;

  await markStepFailed({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.CHECK_PROVISIONING_APPROVAL,
    provider,
    summary: msg,
    details: {
      outcome: check.outcome,
      provisioningRequestId: check.provisioningRequestId,
      requestStatus: check.request?.status ?? null,
      errorCode: check.request?.errorCode ?? null,
    },
    logger,
  });
  await patchSetupRun(
    setupRunId,
    { status: S.SETUP_NEEDS_MANUAL_REVIEW, lastErrorSummary: msg },
    logger
  );

  return {
    outcome: 'manual_review',
    provider,
    provisioningRequestId: check.provisioningRequestId,
    reason: check.outcome,
    setupRunId: rawRun,
    businessId: rawBiz,
  };
}

/**
 * @param {{ setupRunId: string, businessId: string, provisioningRequestId: string }} input
 */
async function provisionGtmResourcesActivity(input) {
  const logger = createLogger({ name: 'provisionGtmResourcesActivity' });
  const { rawRun, rawBiz, setupRunId, businessId } = parseSetupActivityIds(input);
  const provisioningRequestId = input.provisioningRequestId;

  await markStepRunning({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.PROVISION_GTM_RESOURCES,
    provider: 'gtm',
    logger,
  });

  try {
    const result = await executeProvisioningRequest({
      requestId: provisioningRequestId,
      businessId,
      setupRunId,
      logger,
    });
    await markStepSuccess({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.PROVISION_GTM_RESOURCES,
      provider: 'gtm',
      details: {
        provisioningRequestId,
        providerIdentifiers: result.providerIdentifiers,
      },
      logger,
    });
    await patchSetupRun(setupRunId, { status: S.GTM_PROVISIONED, lastErrorSummary: null }, logger);
    await mergeSetupRunMeta(
      setupRunId,
      {
        gtmProvisioning: 'provisioned',
        gtmProvisioningRequestId: provisioningRequestId,
        gtmProviderIdentifiers: result.providerIdentifiers,
      },
      logger
    );
    return {
      outcome: 'ok',
      provider: 'gtm',
      provisioningRequestId,
      providerIdentifiers: result.providerIdentifiers,
      setupRunId: rawRun,
      businessId: rawBiz,
    };
  } catch (err) {
    const msg = safeErrorMessage(err, 'GTM provisioning failed');
    const code =
      err instanceof GtmProvisioningError || err instanceof ProvisioningServiceError
        ? err.code
        : 'GTM_PROVISIONING_FAILED';
    await markStepFailed({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.PROVISION_GTM_RESOURCES,
      provider: 'gtm',
      summary: msg,
      details: { code, provisioningRequestId },
      logger,
    });
    await recordSetupFailureSupport({
      setupRunId,
      businessId,
      failedStep: SETUP_STEP_NAMES.PROVISION_GTM_RESOURCES,
      errorCode: code,
      logger,
    });
    await patchSetupRun(setupRunId, { status: S.FAILED, lastErrorSummary: msg }, logger);
    throw ApplicationFailure.nonRetryable(msg, code);
  }
}

/**
 * @param {{ setupRunId: string, businessId: string, provisioningRequestId: string }} input
 */
async function provisionGoogleAdsCustomerActivity(input) {
  const logger = createLogger({ name: 'provisionGoogleAdsCustomerActivity' });
  const { rawRun, rawBiz, setupRunId, businessId } = parseSetupActivityIds(input);
  const provisioningRequestId = input.provisioningRequestId;

  await markStepRunning({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.PROVISION_GOOGLE_ADS_CUSTOMER,
    provider: 'google_ads',
    logger,
  });

  try {
    const result = await executeProvisioningRequest({
      requestId: provisioningRequestId,
      businessId,
      setupRunId,
      logger,
    });
    await markStepSuccess({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.PROVISION_GOOGLE_ADS_CUSTOMER,
      provider: 'google_ads',
      details: {
        provisioningRequestId,
        providerIdentifiers: result.providerIdentifiers,
      },
      logger,
    });
    await patchSetupRun(setupRunId, { status: S.ADS_PROVISIONED, lastErrorSummary: null }, logger);
    await mergeSetupRunMeta(
      setupRunId,
      {
        googleAdsProvisioning: 'provisioned',
        googleAdsProvisioningRequestId: provisioningRequestId,
        googleAdsProviderIdentifiers: result.providerIdentifiers,
      },
      logger
    );
    return {
      outcome: 'ok',
      provider: 'google_ads',
      provisioningRequestId,
      providerIdentifiers: result.providerIdentifiers,
      setupRunId: rawRun,
      businessId: rawBiz,
    };
  } catch (err) {
    const msg = safeErrorMessage(err, 'Google Ads provisioning failed');
    const code =
      err instanceof AdsProvisioningError || err instanceof ProvisioningServiceError
        ? err.code
        : 'ADS_PROVISIONING_FAILED';
    await markStepFailed({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.PROVISION_GOOGLE_ADS_CUSTOMER,
      provider: 'google_ads',
      summary: msg,
      details: { code, provisioningRequestId },
      logger,
    });
    await recordSetupFailureSupport({
      setupRunId,
      businessId,
      failedStep: SETUP_STEP_NAMES.PROVISION_GOOGLE_ADS_CUSTOMER,
      errorCode: code,
      logger,
    });
    await patchSetupRun(setupRunId, { status: S.FAILED, lastErrorSummary: msg }, logger);
    throw ApplicationFailure.nonRetryable(msg, code);
  }
}

module.exports = {
  loadSetupContextActivity,
  checkGbpPreconditionsActivity,
  checkGtmPreconditionsActivity,
  checkGoogleAdsPreconditionsActivity,
  checkProviderPreconditionsActivity,
  checkProvisioningApprovalActivity,
  provisionGtmResourcesActivity,
  provisionGoogleAdsCustomerActivity,
  runGbpAuditActivity,
  fetchAdsConversionCatalogActivity,
  runGtmConversionSetupActivity,
  runStructuralVerificationActivity,
  createAdsCampaignActivity,
};
