'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('../middleware/requireAuth');
const { requireAdmin } = require('../middleware/requireAdmin');

const router = express.Router();
const User = mongoose.model('User');
const BusinessContext = mongoose.model('BusinessContext');
const SetupRun = mongoose.model('SetupRun');
const { buildSetupRunReport } = require('../../../services/reports/setupRunReportService');
const {
  applyOperatorFactCheck,
  recordSetupCallConfirmation,
  approveCampaignSlot,
  sendBackCampaignSlot,
  retireCampaignSlot,
  LeadCampaignOperatorError,
} = require('../../../services/capabilities/leadCampaignOperatorService');
const {
  startOperatorOnboardingScrape,
  LeadCampaignScrapeError,
} = require('../../../services/capabilities/leadCampaignScrapeService');
const { getLeadCampaignSet } = require('../../../services/capabilities/leadCampaignSetService');
const { refreshTrackingStatusForBusiness } = require('../../../services/capabilities/leadCampaignTrackingService');
const {
  regenerateCampaignSlotAd,
  LeadCampaignRegenerationError,
} = require('../../../services/capabilities/leadCampaignRegenerationService');
const {
  OperatorCallWorkflowError,
  resolveOperatorListStatus,
  getOperatorCallContext,
  saveStartCall,
  saveCallLiveCheck,
  saveBeforePageSource,
  saveCallAccountSettings,
  saveCallBusinessAnswers,
  saveCallWebsite,
  saveCallGoalChoice,
  saveCallPermission,
  saveCallSnippetNew,
  saveCallSnippetExistingGtm,
  saveCallSnippetPasted,
  saveCallClose,
  saveAfterPageSource,
  saveAfterFormResult,
  saveAfterTestLeadPassed,
  clearOperatorFollowUp,
} = require('../../../services/capabilities/operatorCallWorkflowService');

router.use(requireAuth, requireAdmin);

function mapOperatorCallError(err, res) {
  if (err instanceof OperatorCallWorkflowError) {
    const statusByCode = {
      not_found: 404,
      validation_error: 400,
    };
    return res.status(statusByCode[err.code] ?? 400).json({ error: err.code, message: err.message });
  }
  return null;
}

function parseBusinessIdParam(req, res) {
  const businessId = req.params.businessId;
  if (!mongoose.Types.ObjectId.isValid(businessId)) {
    res.status(400).json({ error: 'validation_error', message: 'Invalid businessId' });
    return null;
  }
  return businessId;
}

router.get('/users', async (_req, res) => {
  const users = await User.find().select('email name platformAdmin createdAt').limit(200).lean();
  res.status(200).json({
    users: users.map((u) => ({
      id: u._id.toString(),
      email: u.email,
      name: u.name ?? null,
      platformAdmin: Boolean(u.platformAdmin),
      createdAt: u.createdAt,
    })),
  });
});

router.get('/businesses', async (_req, res) => {
  const rows = await BusinessContext.find()
    .select(
      'businessId businessName userId orgId confirmedAt updatedAt signupCompletedAt operatorCallWorkflow'
    )
    .sort({ updatedAt: -1 })
    .limit(200)
    .lean();
  const userIds = [...new Set(rows.map((bc) => String(bc.userId)))];
  const users = await User.find({ _id: { $in: userIds } })
    .select('email')
    .lean();
  const emailByUserId = new Map(users.map((u) => [String(u._id), u.email]));
  res.status(200).json({
    businesses: rows.map((bc) => ({
      businessId: bc.businessId.toString(),
      businessName: bc.businessName ?? null,
      userId: bc.userId.toString(),
      customerEmail: emailByUserId.get(String(bc.userId)) ?? null,
      orgId: bc.orgId ? bc.orgId.toString() : null,
      confirmedAt: bc.confirmedAt ?? null,
      updatedAt: bc.updatedAt,
      operatorListStatus: resolveOperatorListStatus(bc),
    })),
  });
});

router.get('/businesses/:businessId/operator-call', async (req, res, next) => {
  try {
    const businessId = parseBusinessIdParam(req, res);
    if (!businessId) return;
    const context = await getOperatorCallContext(businessId);
    return res.status(200).json({ context });
  } catch (err) {
    const mapped = mapOperatorCallError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.patch('/businesses/:businessId/operator-call/start-call', async (req, res, next) => {
  try {
    const businessId = parseBusinessIdParam(req, res);
    if (!businessId) return;
    const context = await saveStartCall(businessId);
    return res.status(200).json({ context });
  } catch (err) {
    const mapped = mapOperatorCallError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.patch('/businesses/:businessId/operator-call/call/live-check', async (req, res, next) => {
  try {
    const businessId = parseBusinessIdParam(req, res);
    if (!businessId) return;
    const context = await saveCallLiveCheck(businessId, req.body ?? {});
    return res.status(200).json({ context });
  } catch (err) {
    const mapped = mapOperatorCallError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.patch('/businesses/:businessId/operator-call/before-page-source', async (req, res, next) => {
  try {
    const businessId = parseBusinessIdParam(req, res);
    if (!businessId) return;
    const context = await saveBeforePageSource(businessId, req.body ?? {});
    return res.status(200).json({ context });
  } catch (err) {
    const mapped = mapOperatorCallError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.patch('/businesses/:businessId/operator-call/call/account-settings', async (req, res, next) => {
  try {
    const businessId = parseBusinessIdParam(req, res);
    if (!businessId) return;
    const context = await saveCallAccountSettings(businessId, req.body ?? {});
    return res.status(200).json({ context });
  } catch (err) {
    const mapped = mapOperatorCallError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.patch('/businesses/:businessId/operator-call/call/business-answers', async (req, res, next) => {
  try {
    const businessId = parseBusinessIdParam(req, res);
    if (!businessId) return;
    const context = await saveCallBusinessAnswers(businessId, req.body ?? {});
    return res.status(200).json({ context });
  } catch (err) {
    const mapped = mapOperatorCallError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.patch('/businesses/:businessId/operator-call/call/website', async (req, res, next) => {
  try {
    const businessId = parseBusinessIdParam(req, res);
    if (!businessId) return;
    const triggerFetch = req.body?.triggerFetch === true;
    const context = await saveCallWebsite(businessId, req.body ?? {}, triggerFetch);
    return res.status(200).json({ context });
  } catch (err) {
    const mapped = mapOperatorCallError(err, res) ?? mapOperatorError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.patch('/businesses/:businessId/operator-call/call/goal-choice', async (req, res, next) => {
  try {
    const businessId = parseBusinessIdParam(req, res);
    if (!businessId) return;
    const context = await saveCallGoalChoice(businessId, req.body ?? {});
    return res.status(200).json({ context });
  } catch (err) {
    const mapped = mapOperatorCallError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.patch('/businesses/:businessId/operator-call/call/permission', async (req, res, next) => {
  try {
    const businessId = parseBusinessIdParam(req, res);
    if (!businessId) return;
    const context = await saveCallPermission(businessId, req.body ?? {});
    return res.status(200).json({ context });
  } catch (err) {
    const mapped = mapOperatorCallError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.patch('/businesses/:businessId/operator-call/call/snippet-new', async (req, res, next) => {
  try {
    const businessId = parseBusinessIdParam(req, res);
    if (!businessId) return;
    const context = await saveCallSnippetNew(businessId, req.body ?? {});
    return res.status(200).json({ context });
  } catch (err) {
    const mapped = mapOperatorCallError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.patch('/businesses/:businessId/operator-call/call/snippet-existing-gtm', async (req, res, next) => {
  try {
    const businessId = parseBusinessIdParam(req, res);
    if (!businessId) return;
    const context = await saveCallSnippetExistingGtm(businessId, req.body ?? {});
    return res.status(200).json({ context });
  } catch (err) {
    const mapped = mapOperatorCallError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.patch('/businesses/:businessId/operator-call/call/snippet-pasted', async (req, res, next) => {
  try {
    const businessId = parseBusinessIdParam(req, res);
    if (!businessId) return;
    const context = await saveCallSnippetPasted(businessId, req.body ?? {});
    return res.status(200).json({ context });
  } catch (err) {
    const mapped = mapOperatorCallError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.patch('/businesses/:businessId/operator-call/call/close', async (req, res, next) => {
  try {
    const businessId = parseBusinessIdParam(req, res);
    if (!businessId) return;
    const context = await saveCallClose(businessId);
    return res.status(200).json({ context });
  } catch (err) {
    const mapped = mapOperatorCallError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.patch('/businesses/:businessId/operator-call/after/page-source', async (req, res, next) => {
  try {
    const businessId = parseBusinessIdParam(req, res);
    if (!businessId) return;
    const context = await saveAfterPageSource(businessId, req.body ?? {});
    return res.status(200).json({ context });
  } catch (err) {
    const mapped = mapOperatorCallError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.patch('/businesses/:businessId/operator-call/after/form-result', async (req, res, next) => {
  try {
    const businessId = parseBusinessIdParam(req, res);
    if (!businessId) return;
    const context = await saveAfterFormResult(businessId, req.body ?? {});
    return res.status(200).json({ context });
  } catch (err) {
    const mapped = mapOperatorCallError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.patch('/businesses/:businessId/operator-call/after/test-lead-passed', async (req, res, next) => {
  try {
    const businessId = parseBusinessIdParam(req, res);
    if (!businessId) return;
    const context = await saveAfterTestLeadPassed(businessId);
    return res.status(200).json({ context });
  } catch (err) {
    const mapped = mapOperatorCallError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.patch('/businesses/:businessId/operator-call/clear-follow-up', async (req, res, next) => {
  try {
    const businessId = parseBusinessIdParam(req, res);
    if (!businessId) return;
    const note = typeof req.body?.note === 'string' ? req.body.note : '';
    const context = await clearOperatorFollowUp(businessId, note);
    return res.status(200).json({ context });
  } catch (err) {
    const mapped = mapOperatorCallError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.get('/setup-runs/:setupRunId/report', async (req, res) => {
  const sidRaw = req.params.setupRunId;
  if (!mongoose.Types.ObjectId.isValid(sidRaw)) {
    return res.status(400).json({ error: 'validation_error', message: 'Invalid setupRunId' });
  }
  const setupRunId = new mongoose.Types.ObjectId(sidRaw);
  const report = await buildSetupRunReport(setupRunId);
  if (!report) {
    return res.status(404).json({ error: 'not_found', message: 'Setup run not found' });
  }
  return res.status(200).json({ report });
});

function mapOperatorError(err, res) {
  if (
    err instanceof LeadCampaignOperatorError ||
    err instanceof LeadCampaignScrapeError ||
    err instanceof LeadCampaignRegenerationError
  ) {
    const statusByCode = {
      not_found: 404,
      validation_error: 400,
      campaign_retired: 409,
      invalid_review_state: 409,
      ADS_PLAN_NOT_FOUND: 404,
      ADS_AD_GROUP_NOT_FOUND: 404,
      SCRAPE_CLAIM_IN_PROGRESS: 409,
      temporal_unavailable: 503,
    };
    return res.status(statusByCode[err.code] ?? 400).json({ error: err.code, message: err.message });
  }
  return null;
}

router.patch('/businesses/:businessId/fact-check', async (req, res, next) => {
  try {
    const businessId = req.params.businessId;
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return res.status(400).json({ error: 'validation_error', message: 'Invalid businessId' });
    }
    const doc = await applyOperatorFactCheck(businessId, req.body ?? {});
    return res.status(200).json({
      businessId: doc.businessId.toString(),
      saved: true,
    });
  } catch (err) {
    const mapped = mapOperatorError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.post('/businesses/:businessId/scrape', async (req, res, next) => {
  try {
    const businessId = req.params.businessId;
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return res.status(400).json({ error: 'validation_error', message: 'Invalid businessId' });
    }
    const result = await startOperatorOnboardingScrape(businessId, req.user.id);
    return res.status(result.idempotent ? 200 : 202).json(result);
  } catch (err) {
    const mapped = mapOperatorError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.post('/businesses/:businessId/setup-call', async (req, res, next) => {
  try {
    const businessId = req.params.businessId;
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return res.status(400).json({ error: 'validation_error', message: 'Invalid businessId' });
    }
    const result = await recordSetupCallConfirmation(businessId, req.body ?? {});
    return res.status(200).json(result);
  } catch (err) {
    const mapped = mapOperatorError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.get('/businesses/:businessId/lead-campaigns', async (req, res, next) => {
  try {
    const businessId = req.params.businessId;
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return res.status(400).json({ error: 'validation_error', message: 'Invalid businessId' });
    }
    const { CAMPAIGN_SEND_BACK_REASONS } = require('../../../constants/leadCampaign');
    const set = await getLeadCampaignSet(businessId);
    const tracking = await refreshTrackingStatusForBusiness(businessId);
    return res.status(200).json({
      leadCampaignSet: set,
      tracking,
      sendBackReasons: CAMPAIGN_SEND_BACK_REASONS,
    });
  } catch (err) {
    return next(err);
  }
});

router.post('/businesses/:businessId/lead-campaigns/:slot/approve', async (req, res, next) => {
  try {
    const { businessId, slot } = req.params;
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return res.status(400).json({ error: 'validation_error', message: 'Invalid businessId' });
    }
    const doc = await approveCampaignSlot(businessId, slot, req.body?.note);
    return res.status(200).json({ leadCampaignSet: doc });
  } catch (err) {
    const mapped = mapOperatorError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.post('/businesses/:businessId/lead-campaigns/:slot/send-back', async (req, res, next) => {
  try {
    const { businessId, slot } = req.params;
    const reasonCode = typeof req.body?.reasonCode === 'string' ? req.body.reasonCode.trim() : '';
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return res.status(400).json({ error: 'validation_error', message: 'Invalid businessId' });
    }
    const doc = await sendBackCampaignSlot(businessId, slot, reasonCode, req.body?.note);
    return res.status(200).json({ leadCampaignSet: doc });
  } catch (err) {
    const mapped = mapOperatorError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.post('/businesses/:businessId/lead-campaigns/:slot/regenerate', async (req, res, next) => {
  try {
    const { businessId, slot } = req.params;
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return res.status(400).json({ error: 'validation_error', message: 'Invalid businessId' });
    }
    const result = await regenerateCampaignSlotAd(businessId, slot);
    return res.status(200).json(result);
  } catch (err) {
    const mapped = mapOperatorError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.post('/businesses/:businessId/lead-campaigns/:slot/retire', async (req, res, next) => {
  try {
    const { businessId, slot } = req.params;
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return res.status(400).json({ error: 'validation_error', message: 'Invalid businessId' });
    }
    const doc = await retireCampaignSlot(businessId, slot, req.body?.note);
    return res.status(200).json({ leadCampaignSet: doc });
  } catch (err) {
    const mapped = mapOperatorError(err, res);
    if (mapped) return mapped;
    return next(err);
  }
});

router.get('/setup-runs', async (_req, res) => {
  const runs = await SetupRun.find()
    .select('businessId status temporalWorkflowId createdAt updatedAt')
    .sort({ updatedAt: -1 })
    .limit(200)
    .lean();
  res.status(200).json({
    setupRuns: runs.map((run) => ({
      setupRunId: run._id.toString(),
      businessId: run.businessId.toString(),
      status: run.status,
      temporalWorkflowId: run.temporalWorkflowId ?? null,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    })),
  });
});

module.exports = router;
