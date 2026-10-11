'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('./middleware/requireAuth');
const {
  assertBusinessMembershipOrPlatformAdmin,
  isPlatformAdminUser,
} = require('./lib/platformAdminBusinessAccess');
const { MembershipCheckError } = require('../../lib/auth/membershipCheck');
const { checkSnippetOnSite } = require('../../services/capabilities/businessSetupSnippetService');
const {
  startTrackingTest,
  pollTrackingTest,
  BusinessSetupTrackingTestError,
} = require('../../services/capabilities/businessSetupTrackingTestService');
const {
  applyCustomerFactCheck,
  applyOperatorFactCheck,
  LeadCampaignOperatorError,
} = require('../../services/capabilities/leadCampaignOperatorService');
const LeadCampaignSet = mongoose.model('LeadCampaignSet');

const router = express.Router();

async function assertBusinessAccess(req, businessIdRaw) {
  if (!mongoose.Types.ObjectId.isValid(businessIdRaw)) {
    return { error: { status: 400, body: { error: 'validation_error', message: 'Invalid businessId' } } };
  }
  try {
    await assertBusinessMembershipOrPlatformAdmin(req.user.id, businessIdRaw);
  } catch (err) {
    if (err instanceof MembershipCheckError) {
      const status = err.code === 'forbidden' ? 403 : 404;
      return { error: { status, body: { error: err.code, message: err.message } } };
    }
    throw err;
  }
  return { businessId: new mongoose.Types.ObjectId(businessIdRaw) };
}

function mapOperatorError(err, res) {
  if (err instanceof LeadCampaignOperatorError) {
    const status =
      err.code === 'validation_error' ? 400 : err.code === 'forbidden' ? 403 : 404;
    res.status(status).json({ error: err.code, message: err.message });
    return true;
  }
  if (err instanceof BusinessSetupTrackingTestError) {
    const status = err.code === 'validation_error' ? 400 : 502;
    res.status(status).json({ error: err.code, message: err.message });
    return true;
  }
  return false;
}

router.post('/check-snippet', requireAuth, async (req, res, next) => {
  const businessIdRaw = req.body?.businessId;
  const access = await assertBusinessAccess(req, businessIdRaw);
  if (access.error) return res.status(access.error.status).json(access.error.body);

  try {
    const result = await checkSnippetOnSite(access.businessId);
    return res.status(200).json(result);
  } catch (err) {
    return next(err);
  }
});

router.post('/tracking-test/start', requireAuth, async (req, res, next) => {
  const businessIdRaw = req.body?.businessId;
  const access = await assertBusinessAccess(req, businessIdRaw);
  if (access.error) return res.status(access.error.status).json(access.error.body);

  try {
    const result = await startTrackingTest(access.businessId);
    return res.status(200).json(result);
  } catch (err) {
    if (mapOperatorError(err, res)) return undefined;
    return next(err);
  }
});

router.get('/tracking-test/result', requireAuth, async (req, res, next) => {
  const businessIdRaw = req.query.businessId;
  const access = await assertBusinessAccess(req, businessIdRaw);
  if (access.error) return res.status(access.error.status).json(access.error.body);

  try {
    const result = await pollTrackingTest(access.businessId);
    return res.status(200).json(result);
  } catch (err) {
    if (mapOperatorError(err, res)) return undefined;
    return next(err);
  }
});

router.post('/gbp-skip', requireAuth, async (req, res, next) => {
  const businessIdRaw = req.body?.businessId;
  const access = await assertBusinessAccess(req, businessIdRaw);
  if (access.error) return res.status(access.error.status).json(access.error.body);

  try {
    await LeadCampaignSet.findOneAndUpdate(
      { businessId: access.businessId },
      {
        $set: { gbpSkippedAt: new Date() },
        $setOnInsert: { businessId: access.businessId },
      },
      { upsert: true }
    );
    return res.status(200).json({ skipped: true });
  } catch (err) {
    return next(err);
  }
});

router.patch('/fact-confirm', requireAuth, async (req, res, next) => {
  const businessIdRaw = req.body?.businessId;
  const access = await assertBusinessAccess(req, businessIdRaw);
  if (access.error) return res.status(access.error.status).json(access.error.body);

  const { businessId: _ignored, ...corrections } = req.body ?? {};

  try {
    const isAdmin = await isPlatformAdminUser(req.user.id);
    const doc = await (isAdmin
      ? applyOperatorFactCheck(access.businessId, corrections)
      : applyCustomerFactCheck(access.businessId, corrections));
    return res.status(200).json({
      businessId: doc.businessId.toString(),
      factCheckCompletedAt: doc.factCheckCompletedAt?.toISOString() ?? null,
      saved: true,
    });
  } catch (err) {
    if (mapOperatorError(err, res)) return undefined;
    return next(err);
  }
});

module.exports = router;
