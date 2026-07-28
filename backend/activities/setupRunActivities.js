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
const { recordSetupFailureSupport, recordSetupRecoveryState } = require('./lib/setupFailureSupport');
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
  verifyGoogleAdsOAuthConnection,
  discoverAndPersistGoogleAdsCustomers,
  ensureGoogleAdsProvisioningApproval,
  assertGoogleAdsSetupReady,
  GoogleAdsSetupError,
} = require('../services/capabilities');
const conversionActionManagement = require('../services/capabilities/adsConversionActionManagementService');
const {
  validateBusinessContextAdsReadiness,
  formatAdsReadinessSummary,
} = require('../services/capabilities/businessContextAdsReadinessService');
const { formatAdsCampaignPreconditionDetails } = require('../services/capabilities/adsCampaignIntentService');
const { GtmApiError } = require('../services/integrations/googleTagManagerClient');

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

  const adsReadiness = validateBusinessContextAdsReadiness(bc);
  if (!adsReadiness.ok) {
    const msg = formatAdsReadinessSummary(adsReadiness);
    await markStepFailed({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.LOAD_CONTEXT,
      summary: msg,
      logger,
      details: { issues: adsReadiness.issues },
    });
    await patchSetupRun(
      setupRunId,
      { status: S.FAILED, lastErrorSummary: msg },
      logger
    );
    return {
      outcome: 'failed',
      reason: msg,
      setupRunId: rawId,
      businessId: businessId.toString(),
      issues: adsReadiness.issues,
    };
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

  try {
    const strategy = conversionActionManagement.deriveConversionStrategy(bc);
    await conversionActionManagement.persistConversionStrategy(businessId, strategy, logger);
  } catch (err) {
    logger.warn(
      {
        setupRunId: rawId,
        businessId: businessId.toString(),
        stepName: SETUP_STEP_NAMES.LOAD_CONTEXT,
        error: safeErrorMessage(err),
      },
      'conversion strategy derivation failed'
    );
  }

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

  const status = await getConnectionStatus(businessId, 'gtm');
  if (status.ready) {
    await markStepSuccess({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.CHECK_GTM_CONNECTION,
      provider: 'gtm',
      details: status,
      logger,
    });
    return {
      outcome: 'ok',
      provider: 'gtm',
      ready: true,
      reason: status.reason,
      setupRunId: rawRun,
      businessId: rawBiz,
    };
  }

  if (status.reason === CONNECTION_REASON.PROVISIONING_REQUIRED) {
    await markStepSuccess({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.CHECK_GTM_CONNECTION,
      provider: 'gtm',
      details: {
        provisioningRequired: true,
        reason: status.reason,
        nextAction: status.nextAction,
        identifiersMissing: status.identifiersMissing,
      },
      logger,
    });
    return {
      outcome: 'gtm_provisioning_required',
      provider: 'gtm',
      ready: false,
      reason: status.reason,
      nextAction: status.nextAction,
      setupRunId: rawRun,
      businessId: rawBiz,
    };
  }

  await markStepSkipped({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.CHECK_GTM_CONNECTION,
    provider: 'gtm',
    details: {
      optional: true,
      reason: status.reason,
      nextAction: status.nextAction,
      identifiersMissing: status.identifiersMissing,
    },
    logger,
  });
  await mergeSetupRunMeta(
    setupRunId,
    {
      gtmOptional: true,
      gtmNudgeReason: status.reason,
      gtmNudgeNextAction: status.nextAction ?? null,
    },
    logger
  );

  return {
    outcome: 'not_ready',
    provider: 'gtm',
    ready: false,
    reason: status.reason,
    nextAction: status.nextAction,
    setupRunId: rawRun,
    businessId: rawBiz,
  };
}

/**
 * @param {{ setupRunId: string, businessId: string }} input
 */
async function checkGoogleAdsConnectionActivity(input) {
  const logger = createLogger({ name: 'checkGoogleAdsConnectionActivity' });
  const { rawRun, rawBiz, setupRunId, businessId } = parseSetupActivityIds(input);

  await markStepRunning({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.CHECK_GOOGLE_ADS_CONNECTION,
    provider: 'google_ads',
    logger,
  });

  const status = await verifyGoogleAdsOAuthConnection(businessId, { attemptRefresh: true });
  if (status.oauthReady) {
    await markStepSuccess({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.CHECK_GOOGLE_ADS_CONNECTION,
      provider: 'google_ads',
      details: {
        reason: status.reason,
        scopesMissing: status.scopesMissing,
        connectionHealth: status.connectionHealth,
      },
      logger,
    });
    return {
      outcome: 'ok',
      provider: 'google_ads',
      ready: status.identifiersReady,
      reason: status.reason,
      setupRunId: rawRun,
      businessId: rawBiz,
    };
  }

  return blockSetupForMissingProviders({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.CHECK_GOOGLE_ADS_CONNECTION,
    missing: ['google_ads'],
    logger,
  });
}

/**
 * @param {{ setupRunId: string, businessId: string }} input
 */
async function discoverGoogleAdsCustomersActivity(input) {
  const logger = createLogger({ name: 'discoverGoogleAdsCustomersActivity' });
  const { rawRun, rawBiz, setupRunId, businessId } = parseSetupActivityIds(input);

  await markStepRunning({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.DISCOVER_GOOGLE_ADS_CUSTOMERS,
    provider: 'google_ads',
    logger,
  });

  try {
    const discovery = await discoverAndPersistGoogleAdsCustomers({ businessId, setupRunId, logger });

    if (discovery.outcome === 'ok') {
      await markStepSuccess({
        setupRunId,
        businessId,
        stepName: SETUP_STEP_NAMES.DISCOVER_GOOGLE_ADS_CUSTOMERS,
        provider: 'google_ads',
        details: {
          customerId: discovery.customerId,
          accessibleCustomerCount: discovery.accessibleCustomerIds.length,
        },
        logger,
      });
      return {
        outcome: 'ok',
        provider: 'google_ads',
        customerId: discovery.customerId,
        accessibleCustomerIds: discovery.accessibleCustomerIds,
        setupRunId: rawRun,
        businessId: rawBiz,
      };
    }

    if (discovery.outcome === 'selection_required') {
      const msg = 'Select a Google Ads customer on the setup page before continuing.';
      await markStepSkipped({
        setupRunId,
        businessId,
        stepName: SETUP_STEP_NAMES.DISCOVER_GOOGLE_ADS_CUSTOMERS,
        provider: 'google_ads',
        details: {
          selectionRequired: true,
          accessibleCustomerCount: discovery.accessibleCustomerIds?.length ?? 0,
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
        provider: 'google_ads',
        errorCode: 'ADS_CUSTOMER_SELECTION_REQUIRED',
        message: msg,
        accessibleCustomerIds: discovery.accessibleCustomerIds ?? [],
        setupRunId: rawRun,
        businessId: rawBiz,
      };
    }

    if (discovery.outcome === 'customer_not_found') {
      const msg =
        'No accessible Google Ads customer was found for this Google account. Create a Google Ads account (or connect a different Google account), then start a new setup run.';
      await markStepSkipped({
        setupRunId,
        businessId,
        stepName: SETUP_STEP_NAMES.DISCOVER_GOOGLE_ADS_CUSTOMERS,
        provider: 'google_ads',
        details: {
          customerNotFound: true,
          accessibleCustomerCount: 0,
        },
        logger,
      });
      await patchSetupRun(
        setupRunId,
        { status: S.SETUP_NEEDS_MANUAL_REVIEW, lastErrorSummary: msg },
        logger
      );
      await mergeSetupRunMeta(
        setupRunId,
        {
          googleAdsDiscovery: 'customer_not_found',
          googleAdsDiscoveryReason: 'ADS_CUSTOMER_NOT_FOUND',
        },
        logger
      );
      return {
        outcome: 'manual_review',
        provider: 'google_ads',
        errorCode: 'ADS_CUSTOMER_NOT_FOUND',
        message: msg,
        accessibleCustomerIds: [],
        setupRunId: rawRun,
        businessId: rawBiz,
      };
    }

    if (discovery.outcome !== 'provisioning_required') {
      const msg = `Unexpected Google Ads discovery outcome: ${discovery.outcome}`;
      await markStepFailed({
        setupRunId,
        businessId,
        stepName: SETUP_STEP_NAMES.DISCOVER_GOOGLE_ADS_CUSTOMERS,
        provider: 'google_ads',
        summary: msg,
        logger,
      });
      await patchSetupRun(
        setupRunId,
        { status: S.SETUP_NEEDS_MANUAL_REVIEW, lastErrorSummary: msg },
        logger
      );
      return {
        outcome: 'manual_review',
        provider: 'google_ads',
        errorCode: 'ADS_DISCOVERY_UNEXPECTED',
        message: msg,
        setupRunId: rawRun,
        businessId: rawBiz,
      };
    }

    await markStepSkipped({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.DISCOVER_GOOGLE_ADS_CUSTOMERS,
      provider: 'google_ads',
      details: {
        provisioningRequired: true,
        accessibleCustomerCount: 0,
      },
      logger,
    });
    await patchSetupRun(
      setupRunId,
      {
        status: S.ADS_PROVISIONING_REQUIRED,
        lastErrorSummary: 'Approve google_ads provisioning to continue setup.',
      },
      logger
    );
    await mergeSetupRunMeta(
      setupRunId,
      {
        googleAdsProvisioning: 'pending_approval',
        googleAdsDiscovery: 'provisioning_required',
      },
      logger
    );

    return {
      outcome: 'ads_provisioning_required',
      provider: 'google_ads',
      accessibleCustomerIds: [],
      setupRunId: rawRun,
      businessId: rawBiz,
    };
  } catch (err) {
    const msg = safeErrorMessage(err, 'Google Ads customer discovery failed');
    const code = err instanceof GoogleAdsSetupError ? err.code : 'ADS_DISCOVERY_FAILED';
    await markStepFailed({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.DISCOVER_GOOGLE_ADS_CUSTOMERS,
      provider: 'google_ads',
      summary: msg,
      details: {
        code,
        googleAdsError: err instanceof GoogleAdsSetupError ? err.details ?? null : null,
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
      provider: 'google_ads',
      errorCode: code,
      message: msg,
      googleAdsError: err instanceof GoogleAdsSetupError ? err.details ?? null : null,
      setupRunId: rawRun,
      businessId: rawBiz,
    };
  }
}

/**
 * @param {{ setupRunId: string, businessId: string }} input
 */
async function ensureGoogleAdsProvisioningApprovalActivity(input) {
  const logger = createLogger({ name: 'ensureGoogleAdsProvisioningApprovalActivity' });
  const { rawRun, rawBiz, setupRunId, businessId } = parseSetupActivityIds(input);

  await markStepRunning({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.ENSURE_GOOGLE_ADS_PROVISIONING_APPROVAL,
    provider: 'google_ads',
    logger,
  });

  const check = await ensureGoogleAdsProvisioningApproval({ businessId, setupRunId });

  if (check.outcome === 'ready') {
    await markStepSuccess({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.ENSURE_GOOGLE_ADS_PROVISIONING_APPROVAL,
      provider: 'google_ads',
      details: { outcome: check.outcome },
      logger,
    });
    return {
      outcome: 'ready',
      provider: 'google_ads',
      provisioningRequestId: check.provisioningRequestId,
      setupRunId: rawRun,
      businessId: rawBiz,
    };
  }

  if (check.outcome === 'pending_approval') {
    await markStepSkipped({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.ENSURE_GOOGLE_ADS_PROVISIONING_APPROVAL,
      provider: 'google_ads',
      details: {
        outcome: check.outcome,
        provisioningRequestId: check.provisioningRequestId,
      },
      logger,
    });
    await mergeSetupRunMeta(
      setupRunId,
      {
        googleAdsProvisioning: 'pending_approval',
        provisioningRequestId: check.provisioningRequestId,
      },
      logger
    );
    return {
      outcome: 'pending_approval',
      provider: 'google_ads',
      provisioningRequestId: check.provisioningRequestId,
      setupRunId: rawRun,
      businessId: rawBiz,
    };
  }

  if (check.outcome === 'approved') {
    await markStepSuccess({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.ENSURE_GOOGLE_ADS_PROVISIONING_APPROVAL,
      provider: 'google_ads',
      details: {
        outcome: check.outcome,
        provisioningRequestId: check.provisioningRequestId,
      },
      logger,
    });
    return {
      outcome: 'approved',
      provider: 'google_ads',
      provisioningRequestId: check.provisioningRequestId,
      setupRunId: rawRun,
      businessId: rawBiz,
    };
  }

  const msg = `google_ads provisioning approval is not available (${check.reason ?? check.outcome}).`;
  await markStepFailed({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.ENSURE_GOOGLE_ADS_PROVISIONING_APPROVAL,
    provider: 'google_ads',
    summary: msg,
    details: {
      outcome: check.outcome,
      provisioningRequestId: check.provisioningRequestId,
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
    provider: 'google_ads',
    provisioningRequestId: check.provisioningRequestId,
    reason: check.outcome,
    setupRunId: rawRun,
    businessId: rawBiz,
  };
}

/**
 * DB-read-only check that persisted Google Ads identifiers are ready after provisioning.
 * Does not call listAccessibleCustomers.
 *
 * @param {{ setupRunId: string, businessId: string }} input
 */
async function assertGoogleAdsSetupReadyActivity(input) {
  const logger = createLogger({ name: 'assertGoogleAdsSetupReadyActivity' });
  const { rawRun, rawBiz, setupRunId, businessId } = parseSetupActivityIds(input);

  await markStepRunning({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.VERIFY_GOOGLE_ADS_SETUP_READY,
    provider: 'google_ads',
    logger,
  });

  try {
    const providerIdentifiers = await assertGoogleAdsSetupReady(businessId);
    await markStepSuccess({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.VERIFY_GOOGLE_ADS_SETUP_READY,
      provider: 'google_ads',
      details: {
        customerId: providerIdentifiers.customerId ?? null,
        accessibleCustomerCount: Array.isArray(providerIdentifiers.accessibleCustomerIds)
          ? providerIdentifiers.accessibleCustomerIds.length
          : null,
      },
      logger,
    });
    return {
      outcome: 'ok',
      provider: 'google_ads',
      customerId: providerIdentifiers.customerId ?? null,
      accessibleCustomerIds: providerIdentifiers.accessibleCustomerIds ?? [],
      setupRunId: rawRun,
      businessId: rawBiz,
    };
  } catch (err) {
    const msg = safeErrorMessage(err, 'Google Ads setup readiness check failed');
    const code = err instanceof GoogleAdsSetupError ? err.code : 'GOOGLE_ADS_SETUP_NOT_READY';
    await markStepFailed({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.VERIFY_GOOGLE_ADS_SETUP_READY,
      provider: 'google_ads',
      summary: msg,
      details: { code },
      logger,
    });
    await patchSetupRun(
      setupRunId,
      { status: S.SETUP_NEEDS_MANUAL_REVIEW, lastErrorSummary: msg },
      logger
    );
    return {
      outcome: 'manual_review',
      provider: 'google_ads',
      errorCode: code,
      message: msg,
      setupRunId: rawRun,
      businessId: rawBiz,
    };
  }
}

/**
 * @deprecated Use checkGoogleAdsConnectionActivity + discoverGoogleAdsCustomersActivity.
 * @param {{ setupRunId: string, businessId: string }} input
 */
async function checkGoogleAdsPreconditionsActivity(input) {
  const conn = await checkGoogleAdsConnectionActivity(input);
  if (conn.outcome !== 'ok') {
    return conn;
  }
  return discoverGoogleAdsCustomersActivity(input);
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
    details: { required: ['google_ads'] },
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
      await patchSetupRun(
        setupRunId,
        { status: S.GBP_AUDIT_COMPLETE, lastErrorSummary: null },
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
    await patchSetupRun(
      setupRunId,
      { status: S.GBP_AUDIT_COMPLETE, lastErrorSummary: null },
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
    await patchSetupRun(
      setupRunId,
      { status: S.CONVERSION_CATALOG_READY, lastErrorSummary: null },
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

  const gtmStatus = await getConnectionStatus(businessId, 'gtm');
  if (!gtmStatus.ready) {
    await markStepSkipped({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.GTM_CONVERSION_SETUP,
      provider: 'gtm',
      details: { optional: true, reason: gtmStatus.reason, nextAction: gtmStatus.nextAction },
      logger,
    });
    return {
      outcome: 'skipped',
      provider: 'gtm',
      reason: gtmStatus.reason,
      setupRunId: rawRun,
      businessId: rawBiz,
    };
  }

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
    await patchSetupRun(
      setupRunId,
      { status: S.GTM_SETUP_COMPLETE, lastErrorSummary: null },
      logger
    );
    return { outcome: 'ok', setupRunId: rawRun, businessId: rawBiz, summary: result.summary };
  } catch (err) {
    const msg = safeErrorMessage(err, 'GTM setup failed');
    if (err instanceof GtmApiError && err.code === 'GTM_RATE_LIMITED') {
      throw ApplicationFailure.retryable(msg, 'GTM_RATE_LIMITED');
    }
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

  if (verdict.result === 'skipped') {
    await markStepSkipped({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
      provider: 'gtm',
      details: { evidence: verdict.evidence, summary: verdict.summary, optional: true },
      logger,
    });
    await mergeSetupRunMeta(
      setupRunId,
      { structuralVerification: verdict.evidence, structuralVerificationSummary: verdict.summary },
      logger
    );
    return { outcome: 'pass', skipped: true, setupRunId: rawRun, businessId: rawBiz, detail: verdict };
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
      logger,
    );
    await patchSetupRun(
      setupRunId,
      { status: S.STRUCTURAL_VERIFIED, lastErrorSummary: null },
      logger
    );
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
    await recordSetupRecoveryState({
      setupRunId,
      failedStep: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
      errorCode: 'GTM_SNIPPET_PENDING',
      summary: verdict.summary,
      logger,
    });
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
    await recordSetupRecoveryState({
      setupRunId,
      failedStep: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
      errorCode: 'SETUP_NEEDS_TRACKING_FIX',
      summary: verdict.summary,
      logger,
    });
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
    const precondition =
      err instanceof AdsProviderPreconditionError
        ? formatAdsCampaignPreconditionDetails(err)
        : {
            message: safeErrorMessage(err, 'Ads campaign creation failed'),
            code: 'AdsCampaignError',
            validationBucket: null,
            field: null,
            issues: [],
            bucketValidation: null,
          };
    const msg = precondition.message;
    const code = precondition.code;
    const googleAdsDetails =
      err instanceof AdsProviderPreconditionError ? err.googleAdsDetails : undefined;
    logger.error(
      {
        setupRunId: rawRun,
        businessId: rawBiz,
        stepName: SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
        provider: 'google_ads',
        code,
        validationBucket: precondition.validationBucket,
        fieldViolations: googleAdsDetails?.fieldViolations ?? [],
        googleAdsErrors: googleAdsDetails?.googleAdsErrors ?? [],
        requestId: googleAdsDetails?.requestId ?? null,
      },
      'ads campaign creation failed'
    );
    await markStepFailed({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
      provider: 'google_ads',
      summary: msg,
      details: {
        provider: 'google_ads',
        stepName: SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
        message: msg,
        code,
        validationBucket: precondition.validationBucket,
        field: precondition.field,
        issues: precondition.issues,
        bucketValidation: precondition.bucketValidation,
        fieldViolations: googleAdsDetails?.fieldViolations ?? [],
        googleAdsErrors: googleAdsDetails?.googleAdsErrors ?? [],
        requestId: googleAdsDetails?.requestId ?? null,
      },
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

/**
 * Resolves required conversion action slots via catalog match and optional creation.
 * @see activities/lib/manageAdsConversionActionsActivity.contract.js
 * @param {{ setupRunId: string, businessId: string }} input
 */
async function manageAdsConversionActionsActivity(input) {
  const logger = createLogger({ name: 'manageAdsConversionActionsActivity' });
  const { rawRun, rawBiz, setupRunId, businessId } = parseSetupActivityIds(input);

  await markStepRunning({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS,
    provider: 'google_ads',
    logger,
  });

  try {
    const result = await conversionActionManagement.manageConversionActions({
      setupRunId,
      businessId,
      logger,
    });

    if (result.outcome === 'ok') {
      await markStepSuccess({
        setupRunId,
        businessId,
        stepName: SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS,
        provider: 'google_ads',
        details: {
          slotsResolved: result.slotsResolved,
          created: result.created,
          reused: result.reused,
          resolvedPrimaryGoal: result.strategy?.resolvedPrimaryGoal ?? null,
        },
        logger,
      });
      await mergeSetupRunMeta(
        setupRunId,
        {
          conversionActionManagement: 'ok',
          conversionActionSlotsResolved: result.slotsResolved,
          conversionActionsCreated: result.created,
          conversionActionsReused: result.reused,
        },
        logger
      );
      return {
        outcome: 'ok',
        slotsResolved: result.slotsResolved,
        created: result.created,
        reused: result.reused,
        setupRunId: rawRun,
        businessId: rawBiz,
      };
    }

    if (result.outcome === 'missing_goal_data') {
      const msg = result.message ?? 'Business goals are required to derive conversion strategy.';
      await markStepFailed({
        setupRunId,
        businessId,
        stepName: SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS,
        provider: 'google_ads',
        summary: msg,
        details: { code: 'CONVERSION_STRATEGY_MISSING_GOALS' },
        logger,
      });
      await patchSetupRun(
        setupRunId,
        { status: S.SETUP_NEEDS_MANUAL_REVIEW, lastErrorSummary: msg },
        logger
      );
      return {
        outcome: 'manual_review',
        message: msg,
        errorCode: 'CONVERSION_STRATEGY_MISSING_GOALS',
        setupRunId: rawRun,
        businessId: rawBiz,
      };
    }

    if (result.outcome === 'creation_failed') {
      const msg = result.message ?? 'Conversion action creation failed';
      const code = result.errorCode ?? 'CONVERSION_ACTION_CREATE_FAILED';
      await markStepFailed({
        setupRunId,
        businessId,
        stepName: SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS,
        provider: 'google_ads',
        summary: msg,
        details: { code, created: result.created ?? 0, reused: result.reused ?? 0 },
        logger,
      });
      await recordSetupFailureSupport({
        setupRunId,
        businessId,
        failedStep: SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS,
        errorCode: code,
        logger,
      });
      await patchSetupRun(setupRunId, { status: S.FAILED, lastErrorSummary: msg }, logger);
      return {
        outcome: 'creation_failed',
        message: msg,
        errorCode: code,
        setupRunId: rawRun,
        businessId: rawBiz,
      };
    }

    const msg = result.message ?? 'Conversion action management requires manual review.';
    await markStepFailed({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS,
      provider: 'google_ads',
      summary: msg,
      details: { manualReview: true },
      logger,
    });
    await patchSetupRun(
      setupRunId,
      { status: S.SETUP_NEEDS_MANUAL_REVIEW, lastErrorSummary: msg },
      logger
    );
    return {
      outcome: 'manual_review',
      message: msg,
      setupRunId: rawRun,
      businessId: rawBiz,
    };
  } catch (err) {
    const msg = safeErrorMessage(err, 'Conversion action management failed');
    await markStepFailed({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS,
      provider: 'google_ads',
      summary: msg,
      logger,
    });
    await recordSetupFailureSupport({
      setupRunId,
      businessId,
      failedStep: SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS,
      errorCode: 'ConversionActionManagementError',
      logger,
    });
    await patchSetupRun(setupRunId, { status: S.FAILED, lastErrorSummary: msg }, logger);
    throw ApplicationFailure.nonRetryable(msg, 'ConversionActionManagementError');
  }
}

module.exports = {
  loadSetupContextActivity,
  checkGbpPreconditionsActivity,
  checkGtmPreconditionsActivity,
  checkGoogleAdsConnectionActivity,
  discoverGoogleAdsCustomersActivity,
  ensureGoogleAdsProvisioningApprovalActivity,
  assertGoogleAdsSetupReadyActivity,
  checkGoogleAdsPreconditionsActivity,
  checkProviderPreconditionsActivity,
  checkProvisioningApprovalActivity,
  provisionGtmResourcesActivity,
  provisionGoogleAdsCustomerActivity,
  runGbpAuditActivity,
  manageAdsConversionActionsActivity,
  fetchAdsConversionCatalogActivity,
  runGtmConversionSetupActivity,
  runStructuralVerificationActivity,
  createAdsCampaignActivity,
};
