'use strict';

const express = require('express');
const mongoose = require('mongoose');
const BusinessContext = mongoose.model('BusinessContext');
const IntegrationConnection = mongoose.model('IntegrationConnection');
const SetupRun = mongoose.model('SetupRun');
const SetupStepExecution = mongoose.model('SetupStepExecution');
const { requireAuth } = require('./middleware/requireAuth');
const { getTemporalClient } = require('../../lib/temporalClient');
const {
  SETUP_RUN_WORKFLOW_NAME,
  resolveTemporalTaskQueue,
} = require('../../constants/temporalDefaults');
const { buildSetupRunReport, mapOutcomeKind, resolveSetupRecovery } = require('../../services/reports/setupRunReportService');
const { detectStuckSetupRun } = require('../../services/setupRunStuckDetection');
const {
  sanitizeSetupErrorSummary,
  sanitizeStepErrorSummary,
} = require('../../lib/setupUserErrorMessages');
const {
  validateBusinessContextAdsReadiness,
  formatAdsReadinessSummary,
} = require('../../services/capabilities/businessContextAdsReadinessService');
const { resolvePrimaryGoal } = require('../../services/capabilities/adsConversionCatalogService');
const { isSoftLaunchMode } = require('../../constants/softLaunch');
const { deriveBusinessNameKey } = require('../../lib/businessNameKey');
const {
  assertMccLinkReadyForSetup,
  GoogleAdsMccLinkError,
} = require('../../services/capabilities/googleAdsMccLinkService');
const { getGoogleAdsLoginCustomerId } = require('../../services/integrations/googleAdsApiConfig');
const {
  claimSetupStart,
  confirmSetupRunning,
  releaseFailedSetupClaim,
  SetupStartError,
} = require('../../services/setup/businessSetupStateService');
const {
  terminateAndConfirmPriorSetupWorkflow,
} = require('../../services/setup/setupWorkflowCancellationService');
const {
  assertActivePlan,
  SubscriptionGateError,
} = require('../../services/billing/subscriptionGate');
const {
  assertBusinessMembershipOrOwnership,
  MembershipCheckError,
} = require('../../lib/auth/membershipCheck');
const { createLogger } = require('../../lib/observability/logger');

const router = express.Router();

function membershipErrorResponse(err, res) {
  if (err instanceof MembershipCheckError) {
    const status = err.code === 'forbidden' ? 403 : 404;
    return res.status(status).json({ error: err.code, message: err.message });
  }
  return null;
}

/**
 * @param {import('express').Response} res
 * @param {string} userId
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function assertSetupBusinessAccess(res, userId, businessId) {
  try {
    await assertBusinessMembershipOrOwnership(userId, businessId.toString());
    return true;
  } catch (err) {
    const handled = membershipErrorResponse(err, res);
    return handled ? false : Promise.reject(err);
  }
}

/**
 * @param {import('mongoose').Types.ObjectId} businessId
 */
async function findLatestSetupRunForBusiness(businessId) {
  return SetupRun.findOne({ businessId }).sort({ updatedAt: -1 }).lean();
}

router.get('/latest', requireAuth, async (req, res) => {
  const bidRaw = typeof req.query.businessId === 'string' ? req.query.businessId.trim() : '';
  if (!bidRaw || !mongoose.Types.ObjectId.isValid(bidRaw)) {
    return res.status(400).json({
      error: 'validation_error',
      message: 'businessId query parameter is required and must be a valid ObjectId',
    });
  }
  const businessId = new mongoose.Types.ObjectId(bidRaw);

  if (!(await assertSetupBusinessAccess(res, req.user.id, businessId))) {
    return;
  }

  const setupRun = await findLatestSetupRunForBusiness(businessId);
  if (!setupRun) {
    return res.status(200).json({ setupRun: null });
  }

  return res.status(200).json({
    setupRun: {
      id: setupRun._id.toString(),
      businessId: setupRun.businessId.toString(),
      temporalWorkflowId: setupRun.temporalWorkflowId ?? null,
      status: setupRun.status,
      createdAt: setupRun.createdAt,
      updatedAt: setupRun.updatedAt,
    },
  });
});

router.post('/', requireAuth, async (req, res) => {
  const userId = new mongoose.Types.ObjectId(req.user.id);
  const bidRaw = req.body?.businessId;
  if (!bidRaw || typeof bidRaw !== 'string' || !mongoose.Types.ObjectId.isValid(bidRaw)) {
    return res.status(400).json({
      error: 'validation_error',
      message: 'businessId is required and must be a valid ObjectId',
    });
  }
  const businessId = new mongoose.Types.ObjectId(bidRaw);
  const force = req.body?.force === true;
  const confirmCancelPriorRun = req.body?.confirmCancelPriorRun === true;
  const setupStartLogger = createLogger({ name: 'setupRuns.start' });

  if (!(await assertSetupBusinessAccess(res, req.user.id, businessId))) {
    return;
  }

  const bc = await BusinessContext.findOne({ businessId }).lean();

  if (!bc) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Business context not found for this user',
    });
  }

  if (!bc.nameKey) {
    const nameKey = deriveBusinessNameKey(bc.businessName, businessId);
    await BusinessContext.findOneAndUpdate(
      { businessId, nameKey: { $exists: false } },
      { $set: { nameKey } }
    );
    bc.nameKey = nameKey;
  }

  try {
    await assertActivePlan(userId, 'setup_start');
  } catch (err) {
    if (err instanceof SubscriptionGateError) {
      return res.status(403).json({ error: err.code, message: err.message });
    }
    throw err;
  }

  if (!bc.confirmedAt) {
    return res.status(409).json({
      error: 'precondition_failed',
      message:
        'Business context must be confirmed (PUT /business-contexts/:businessId) before starting setup.',
    });
  }

  const adsReadiness = await validateBusinessContextAdsReadiness(bc);
  if (!adsReadiness.ok) {
    return res.status(400).json({
      error: 'validation_error',
      message: formatAdsReadinessSummary(adsReadiness),
      issues: adsReadiness.issues,
    });
  }

  if (isSoftLaunchMode()) {
    const primary = resolvePrimaryGoal(bc.goals);
    if (primary !== 'forms') {
      return res.status(400).json({
        error: 'validation_error',
        message: 'During soft launch, only form-submission goals are supported.',
      });
    }
  }

  if (getGoogleAdsLoginCustomerId()) {
    const adsConnection = await IntegrationConnection.findOne({
      businessId,
      provider: 'google_ads',
    })
      .select('providerIdentifiers')
      .lean();
    const selectedCustomerId = adsConnection?.providerIdentifiers?.customerId;

    if (selectedCustomerId) {
      try {
        await assertMccLinkReadyForSetup(businessId, { refresh: false });
      } catch (err) {
        if (err instanceof GoogleAdsMccLinkError) {
          return res.status(409).json({
            error: err.code === 'ADS_MCC_LINK_PENDING' ? 'mcc_link_pending' : 'mcc_link_required',
            message: err.message,
            mccLink: err.details?.mccLink ?? null,
          });
        }
        throw err;
      }
    }
  }

  if (isSoftLaunchMode() && (force || confirmCancelPriorRun)) {
    const BusinessSetupState = mongoose.model('BusinessSetupState');
    const lock = await BusinessSetupState.findOne({ businessId })
      .select('lockState activeSetupRunId')
      .lean();
    if (lock?.lockState === 'succeeded') {
      return res.status(409).json({
        error: 'setup_already_complete',
        message:
          'Setup already completed for this business. Soft launch does not allow restarting setup.',
        setupRunId: lock.activeSetupRunId?.toString() ?? null,
      });
    }
  }

  let claimResult;
  try {
    if (force && confirmCancelPriorRun) {
      const BusinessSetupState = mongoose.model('BusinessSetupState');
      const lock = await BusinessSetupState.findOne({ businessId }).lean();
      if (lock?.lockState === 'running' && lock.activeSetupRunId) {
        const priorRun = await SetupRun.findById(lock.activeSetupRunId).lean();
        if (priorRun) {
          await terminateAndConfirmPriorSetupWorkflow(priorRun, setupStartLogger);
          await SetupRun.findByIdAndUpdate(priorRun._id, {
            $set: {
              status: 'FAILED',
              lastErrorSummary: 'Superseded by forced setup restart',
              'meta.supersededAt': new Date(),
              'meta.supersededByForce': true,
            },
          });
        }
      }
    }

    claimResult = await claimSetupStart(businessId, {
      force,
      supersedeRunning: force && confirmCancelPriorRun,
    });
  } catch (err) {
    if (err instanceof SetupStartError) {
      let workflowId;
      if (err.details.cancelPriorRunRequired && err.details.setupRunId) {
        const priorRun = await SetupRun.findById(err.details.setupRunId)
          .select('temporalWorkflowId')
          .lean();
        workflowId = priorRun?.temporalWorkflowId ?? null;
      }
      return res.status(409).json({
        error: err.code,
        message: err.message,
        ...(err.details.setupRunId ? { setupRunId: err.details.setupRunId } : {}),
        ...(err.details.cancelPriorRunRequired ? { cancelPriorRunRequired: true } : {}),
        ...(workflowId ? { workflowId } : {}),
      });
    }
    throw err;
  }

  if (claimResult.superseded && claimResult.priorSetupRunId) {
    await SetupRun.findByIdAndUpdate(claimResult.priorSetupRunId, {
      $set: { 'meta.supersededAt': new Date() },
    });
  }

  const setupRun = await SetupRun.create({
    businessId,
    status: 'USER_INPUT_COLLECTED',
  });

  const workflowId = `setup-run-${setupRun._id.toString()}`;
  const taskQueue = resolveTemporalTaskQueue();

  try {
    const client = await getTemporalClient();
    await client.workflow.start(SETUP_RUN_WORKFLOW_NAME, {
      taskQueue,
      workflowId,
      args: [
        {
          setupRunId: setupRun._id.toString(),
          message: 'setup-started',
        },
      ],
    });

    setupRun.temporalWorkflowId = workflowId;
    setupRun.status = 'RUNNING';
    await setupRun.save();
    await confirmSetupRunning(businessId, setupRun._id);

    return res.status(201).json({
      setupRunId: setupRun._id.toString(),
      workflowId,
      status: setupRun.status,
    });
  } catch (err) {
    setupRun.status = 'FAILED';
    setupRun.lastErrorSummary =
      typeof err?.message === 'string' ? err.message : 'Temporal workflow start failed';
    await setupRun.save();
    await releaseFailedSetupClaim(businessId);

    return res.status(503).json({
      error: 'temporal_unavailable',
      message:
        'Setup run was recorded but Temporal workflow could not be started. Check Temporal address and worker.',
      setupRunId: setupRun._id.toString(),
      workflowId: null,
      status: setupRun.status,
      detail: setupRun.lastErrorSummary,
    });
  }
});

router.get('/:setupRunId/report', requireAuth, async (req, res) => {
  const setupUserId = new mongoose.Types.ObjectId(req.user.id);
  const sidRaw = req.params.setupRunId;
  if (!mongoose.Types.ObjectId.isValid(sidRaw)) {
    return res.status(400).json({
      error: 'validation_error',
      message: 'Invalid setupRunId',
    });
  }
  const setupRunId = new mongoose.Types.ObjectId(sidRaw);

  try {
    const setupRun = await SetupRun.findById(setupRunId).lean();
    if (!setupRun) {
      return res.status(404).json({ error: 'not_found', message: 'Setup run not found' });
    }

    const ownsBusiness = await assertBusinessMembershipOrOwnership(
      setupUserId,
      setupRun.businessId.toString()
    ).then(() => true).catch((err) => {
      if (err instanceof MembershipCheckError) return false;
      throw err;
    });
    if (!ownsBusiness) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Setup run not found for this user',
      });
    }

    const report = await buildSetupRunReport(setupRunId);
    if (!report) {
      return res.status(404).json({ error: 'not_found', message: 'Setup run not found' });
    }

    return res.status(200).json({ report });
  } catch {
    return res.status(503).json({
      error: 'service_unavailable',
      message: 'Database query failed. Check MongoDB and MONGODB_URI.',
    });
  }
});

router.get('/:setupRunId', requireAuth, async (req, res) => {
  const setupUserId = new mongoose.Types.ObjectId(req.user.id);
  const sidRaw = req.params.setupRunId;
  if (!mongoose.Types.ObjectId.isValid(sidRaw)) {
    return res.status(400).json({
      error: 'validation_error',
      message: 'Invalid setupRunId',
    });
  }
  const setupRunId = new mongoose.Types.ObjectId(sidRaw);

  try {
    const setupRun = await SetupRun.findById(setupRunId).lean();
    if (!setupRun) {
      return res.status(404).json({ error: 'not_found', message: 'Setup run not found' });
    }

    const ownsBusiness = await assertBusinessMembershipOrOwnership(
      setupUserId,
      setupRun.businessId.toString()
    ).then(() => true).catch((err) => {
      if (err instanceof MembershipCheckError) return false;
      throw err;
    });
    if (!ownsBusiness) {
      return res.status(404).json({
        error: 'not_found',
        message: 'Setup run not found for this user',
      });
    }

    const steps = await SetupStepExecution.find({ setupRunId })
      .sort({ stepName: 1 })
      .lean();

    const stuckState = detectStuckSetupRun(setupRun);
    const supportState =
      setupRun.meta &&
      typeof setupRun.meta === 'object' &&
      setupRun.meta.supportState &&
      typeof setupRun.meta.supportState === 'object'
        ? setupRun.meta.supportState
        : null;
    const supportErrorCode =
      supportState && typeof supportState.errorCode === 'string' ? supportState.errorCode : null;
    const outcomeKind = mapOutcomeKind(setupRun.status);
    const structuralEvidence =
      setupRun.meta &&
      typeof setupRun.meta === 'object' &&
      setupRun.meta.structuralVerification &&
      typeof setupRun.meta.structuralVerification === 'object'
        ? setupRun.meta.structuralVerification
        : null;
    const recovery = resolveSetupRecovery({
      errorCode: supportErrorCode,
      outcomeKind,
      setupRunId: setupRun._id.toString(),
      businessId: setupRun.businessId.toString(),
      structuralEvidence,
      stuckState,
    });

    return res.status(200).json({
      setupRun: {
        id: setupRun._id.toString(),
        businessId: setupRun.businessId.toString(),
        temporalWorkflowId: setupRun.temporalWorkflowId ?? null,
        status: setupRun.status,
        lastErrorSummary: sanitizeSetupErrorSummary(setupRun.lastErrorSummary, supportErrorCode),
        meta: setupRun.meta ?? null,
        createdAt: setupRun.createdAt,
        updatedAt: setupRun.updatedAt,
      },
      stuckState,
      recovery,
      steps: steps.map((s) => ({
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
      })),
    });
  } catch {
    return res.status(503).json({
      error: 'service_unavailable',
      message: 'Database query failed. Check MongoDB and MONGODB_URI.',
    });
  }
});

module.exports = router;
