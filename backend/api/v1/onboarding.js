'use strict';

const express = require('express');
const mongoose = require('mongoose');
const BusinessContext = mongoose.model('BusinessContext');
const ScrapeRun = mongoose.model('ScrapeRun');
const User = mongoose.model('User');
const { requireAuth } = require('./middleware/requireAuth');
const { validateHttpUrl } = require('../../lib/validation');
const { validateIntakeBody } = require('../../lib/intakeValidation');
const { getTemporalClient } = require('../../lib/temporalClient');
const {
  SCRAPE_WORKFLOW_NAME,
  resolveTemporalTaskQueue,
} = require('../../constants/temporalDefaults');
const { SCRAPE_TERMINAL_STATUSES } = require('../../constants/onboarding');
const { isSoftLaunchMode } = require('../../constants/softLaunch');

const router = express.Router();

const TERMINAL_SCRAPE_STATUSES = new Set(SCRAPE_TERMINAL_STATUSES);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findExistingBusinessContextForUser(userId) {
  return BusinessContext.findOne({ userId })
    .sort({ confirmedAt: -1, updatedAt: -1 })
    .lean();
}

router.post('/business', requireAuth, async (req, res, next) => {
  const userId = new mongoose.Types.ObjectId(req.user.id);
  const Membership = mongoose.model('Membership');

  const existingBusinessContext = await findExistingBusinessContextForUser(userId);
  if (existingBusinessContext) {
    return res.status(200).json({
      businessId: existingBusinessContext.businessId.toString(),
    });
  }

  let claimedSoftLaunch = false;
  if (isSoftLaunchMode()) {
    const claim = await User.findOneAndUpdate(
      {
        _id: userId,
        softLaunchClaim: { $exists: false },
      },
      { $set: { softLaunchClaim: true } }
    );
    if (!claim) {
      for (let i = 0; i < 3; i++) {
        await sleep(100);
        const foundExisting = await findExistingBusinessContextForUser(userId);
        if (foundExisting) {
          return res.status(200).json({
            businessId: foundExisting.businessId.toString(),
          });
        }
      }
      return res.status(409).json({
        error: 'soft_launch_single_business',
        message: 'Soft launch supports one business per user.',
      });
    }
    claimedSoftLaunch = true;
  }

  let orgId;
  const membership = await Membership.findOne({ userId, role: 'owner' }).lean();
  if (membership?.orgId) {
    orgId = membership.orgId;
  } else {
    const Org = mongoose.model('Org');
    const user = await User.findById(userId).select('email primaryOrgId').lean();
    if (user?.primaryOrgId) {
      orgId = user.primaryOrgId;
    } else {
      const org = await Org.create({
        name: user?.email ? `${user.email} org` : 'My organization',
        ownerUserId: userId,
      });
      orgId = org._id;
      await Membership.create({ orgId, userId, role: 'owner' });
      await User.findByIdAndUpdate(userId, { $set: { primaryOrgId: orgId } });
    }
  }

  let draft;
  try {
    draft = await BusinessContext.create({
      userId,
      orgId,
    });
  } catch (err) {
    if (claimedSoftLaunch) {
      await User.findByIdAndUpdate(userId, { $unset: { softLaunchClaim: '' } });
    }
    if (err?.name === 'ValidationError') {
      const msg = typeof err.message === 'string' ? err.message : 'Validation failed';
      return res.status(400).json({ error: 'validation_error', message: msg });
    }
    return next(err);
  }

  await User.findOneAndUpdate(
    {
      _id: userId,
      $or: [{ primaryBusinessId: { $exists: false } }, { primaryBusinessId: null }],
    },
    { $set: { primaryBusinessId: draft.businessId } }
  );

  return res.status(201).json({
    businessId: draft.businessId.toString(),
  });
});

router.post('/business/:businessId/intake', requireAuth, async (req, res, next) => {
  const businessIdRaw = req.params.businessId;
  if (!mongoose.Types.ObjectId.isValid(businessIdRaw)) {
    return res.status(400).json({ error: 'validation_error', message: 'Invalid businessId' });
  }
  const businessId = new mongoose.Types.ObjectId(businessIdRaw);
  const userId = new mongoose.Types.ObjectId(req.user.id);

  const parsed = validateIntakeBody(req.body);
  if (!parsed.ok) {
    return res.status(400).json({ error: 'validation_error', message: parsed.message });
  }

  const doc = await BusinessContext.findOne({ businessId, userId });
  if (!doc) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Business draft not found for this user',
    });
  }

  Object.assign(doc, parsed.value);
  try {
    await doc.save();
  } catch (err) {
    return next(err);
  }

  return res.status(200).json({
    businessId: doc.businessId.toString(),
    saved: true,
  });
});

router.post('/business/:businessId/scrape', requireAuth, async (req, res) => {
  return res.status(403).json({
    error: 'forbidden',
    message: 'Customer onboarding scrape is disabled. An operator starts onboarding scrape.',
  });
});

router.get('/business/:businessId/scrape-suggestions', requireAuth, async (req, res) => {
  const userId = new mongoose.Types.ObjectId(req.user.id);
  const businessIdRaw = req.params.businessId;
  if (!mongoose.Types.ObjectId.isValid(businessIdRaw)) {
    return res.status(400).json({ error: 'validation_error', message: 'Invalid businessId' });
  }
  const businessId = new mongoose.Types.ObjectId(businessIdRaw);

  const owns = await BusinessContext.exists({
    businessId,
    userId,
  });
  if (!owns) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Business not found for this user',
    });
  }

  const scrapeRun = await ScrapeRun.findOne({
    businessId,
    userId,
    purpose: 'onboarding',
  })
    .sort({ updatedAt: -1 })
    .lean();

  if (!scrapeRun) {
    return res.status(200).json({ suggested: null, status: null });
  }

  const terminal = TERMINAL_SCRAPE_STATUSES.has(scrapeRun.status);
  const suggested =
    terminal && scrapeRun.resultSuggested && typeof scrapeRun.resultSuggested === 'object'
      ? scrapeRun.resultSuggested
      : null;

  return res.status(200).json({
    suggested,
    status: scrapeRun.status,
  });
});

router.get('/business/:businessId/scrape-runs/:scrapeRunId', requireAuth, async (req, res) => {
  const userId = new mongoose.Types.ObjectId(req.user.id);
  const businessIdRaw = req.params.businessId;
  const scrapeRunIdRaw = req.params.scrapeRunId;
  if (
    !mongoose.Types.ObjectId.isValid(businessIdRaw) ||
    !mongoose.Types.ObjectId.isValid(scrapeRunIdRaw)
  ) {
    return res.status(400).json({ error: 'validation_error', message: 'Invalid id' });
  }
  const businessId = new mongoose.Types.ObjectId(businessIdRaw);
  const scrapeRunId = new mongoose.Types.ObjectId(scrapeRunIdRaw);

  const owns = await BusinessContext.exists({
    businessId,
    userId,
  });
  if (!owns) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Business not found for this user',
    });
  }

  const scrapeRun = await ScrapeRun.findOne({
    _id: scrapeRunId,
    businessId,
    userId,
  }).lean();
  if (!scrapeRun) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Scrape run not found',
    });
  }

  const terminal = TERMINAL_SCRAPE_STATUSES.has(scrapeRun.status);
  const suggested =
    terminal && scrapeRun.resultSuggested && typeof scrapeRun.resultSuggested === 'object'
      ? scrapeRun.resultSuggested
      : null;

  const scrapeQuality =
    suggested && typeof suggested.scrapeQuality === 'string' ? suggested.scrapeQuality : null;
  const manualFallback =
    suggested && typeof suggested.manualFallback === 'boolean' ? suggested.manualFallback : null;

  return res.status(200).json({
    scrapeRun: {
      id: scrapeRun._id.toString(),
      businessId: scrapeRun.businessId.toString(),
      websiteUrl: scrapeRun.websiteUrl,
      temporalWorkflowId: scrapeRun.temporalWorkflowId ?? null,
      status: scrapeRun.status,
      lastErrorSummary: scrapeRun.lastErrorSummary ?? null,
      suggested,
      scrapeQuality,
      manualFallback,
      createdAt: scrapeRun.createdAt,
      updatedAt: scrapeRun.updatedAt,
    },
  });
});

module.exports = router;
