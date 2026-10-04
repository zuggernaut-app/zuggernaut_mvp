'use strict';

const express = require('express');
const mongoose = require('mongoose');
const BusinessContext = mongoose.model('BusinessContext');
const ScrapeRun = mongoose.model('ScrapeRun');
const User = mongoose.model('User');
const { requireAuth } = require('./middleware/requireAuth');
const { validateIntakeBody } = require('../../lib/intakeValidation');
const { SCRAPE_TERMINAL_STATUSES } = require('../../constants/onboarding');
const { createBusinessDraftForUser } = require('../../services/onboarding/businessDraftService');

const router = express.Router();

const TERMINAL_SCRAPE_STATUSES = new Set(SCRAPE_TERMINAL_STATUSES);

router.post('/business', requireAuth, async (req, res, next) => {
  const userId = new mongoose.Types.ObjectId(req.user.id);

  try {
    const { businessId, created } = await createBusinessDraftForUser(userId);
    return res.status(created ? 201 : 200).json({
      businessId: businessId.toString(),
    });
  } catch (err) {
    if (err?.code === 'soft_launch_single_business') {
      return res.status(409).json({
        error: 'soft_launch_single_business',
        message: err.message,
      });
    }
    if (err?.name === 'ValidationError') {
      const msg = typeof err.message === 'string' ? err.message : 'Validation failed';
      return res.status(400).json({ error: 'validation_error', message: msg });
    }
    return next(err);
  }
});

router.post('/business/:businessId/complete-account-links', requireAuth, async (req, res, next) => {
  const businessIdRaw = req.params.businessId;
  if (!mongoose.Types.ObjectId.isValid(businessIdRaw)) {
    return res.status(400).json({ error: 'validation_error', message: 'Invalid businessId' });
  }
  const businessId = new mongoose.Types.ObjectId(businessIdRaw);
  const userId = new mongoose.Types.ObjectId(req.user.id);

  const doc = await BusinessContext.findOne({ businessId, userId });
  if (!doc) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Business draft not found for this user',
    });
  }

  if (!doc.accountLinksCompletedAt) {
    doc.accountLinksCompletedAt = new Date();
    try {
      await doc.save();
    } catch (err) {
      return next(err);
    }
  }

  return res.status(200).json({
    businessId: doc.businessId.toString(),
    accountLinksCompletedAt: doc.accountLinksCompletedAt,
  });
});

router.post('/business/:businessId/intake', requireAuth, async (req, res, next) => {
  const businessIdRaw = req.params.businessId;
  if (!mongoose.Types.ObjectId.isValid(businessIdRaw)) {
    return res.status(400).json({ error: 'validation_error', message: 'Invalid businessId' });
  }
  const businessId = new mongoose.Types.ObjectId(businessIdRaw);
  const userId = new mongoose.Types.ObjectId(req.user.id);

  const existing = await BusinessContext.findOne({ businessId, userId }).lean();
  if (!existing) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Business draft not found for this user',
    });
  }

  const user = await User.findById(userId).select('email phone websiteUrl').lean();
  const mergedBody = {
    ...req.body,
    phone:
      typeof req.body?.phone === 'string' && req.body.phone.trim()
        ? req.body.phone.trim()
        : user?.phone ?? '',
    email:
      typeof req.body?.email === 'string' && req.body.email.trim()
        ? req.body.email.trim()
        : user?.email ?? '',
    websiteUrl:
      typeof req.body?.websiteUrl === 'string' && req.body.websiteUrl.trim()
        ? req.body.websiteUrl.trim()
        : existing.websiteUrl ?? user?.websiteUrl ?? '',
  };

  const parsed = validateIntakeBody(mergedBody);
  if (!parsed.ok) {
    return res.status(400).json({ error: 'validation_error', message: parsed.message });
  }

  const now = new Date();
  const snapshot = {
    submittedAt: now,
    fields: {
      businessName: parsed.value.businessName ?? null,
      services: parsed.value.services ?? [],
      serviceAreas: parsed.value.serviceAreas ?? [],
      whoBuysToday: parsed.value.whoBuysToday ?? null,
      orderValueHint: parsed.value.orderValueHint ?? null,
      howBuyersContact: parsed.value.howBuyersContact ?? null,
      websiteUrl: parsed.value.websiteUrl ?? null,
      contactMethods: parsed.value.contactMethods ?? null,
      intakeFieldSources: parsed.value.intakeFieldSources ?? null,
    },
  };

  let doc;
  try {
    doc = await BusinessContext.findOneAndUpdate(
      { businessId, userId },
      [
        {
          $set: {
            ...parsed.value,
            intakeSubmissions: {
              $concatArrays: [{ $ifNull: ['$intakeSubmissions', []] }, [snapshot]],
            },
            questionsCompletedAt: { $ifNull: ['$questionsCompletedAt', now] },
            confirmedAt: { $ifNull: ['$confirmedAt', now] },
          },
        },
      ],
      { new: true, updatePipeline: true }
    );
  } catch (err) {
    return next(err);
  }

  if (!doc) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Business draft not found for this user',
    });
  }

  return res.status(200).json({
    businessId: doc.businessId.toString(),
    saved: true,
    questionsCompletedAt: doc.questionsCompletedAt,
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
    purpose: 'signup',
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
