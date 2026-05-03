'use strict';

const express = require('express');
const mongoose = require('mongoose');
const BusinessContext = mongoose.model('BusinessContext');
const ScrapeRun = mongoose.model('ScrapeRun');
const User = mongoose.model('User');
const { devUserRequired } = require('./middleware/devUser');
const { validateHttpUrl } = require('../../lib/validation');
const { getTemporalClient } = require('../../lib/temporalClient');

const router = express.Router();

const TERMINAL_SCRAPE_STATUSES = new Set(['SUCCEEDED', 'PARTIAL', 'BLOCKED', 'FAILED']);

router.post('/business', devUserRequired, async (req, res) => {
  const draft = await BusinessContext.create({
    userId: req.devUserId,
  });

  await User.findOneAndUpdate(
    {
      _id: req.devUserId,
      $or: [{ primaryBusinessId: { $exists: false } }, { primaryBusinessId: null }],
    },
    { $set: { primaryBusinessId: draft.businessId } }
  );

  return res.status(201).json({
    businessId: draft.businessId.toString(),
  });
});

router.post('/business/:businessId/scrape', devUserRequired, async (req, res) => {
  const businessIdRaw = req.params.businessId;
  if (!mongoose.Types.ObjectId.isValid(businessIdRaw)) {
    return res.status(400).json({ error: 'validation_error', message: 'Invalid businessId' });
  }
  const businessId = new mongoose.Types.ObjectId(businessIdRaw);

  const urlCheck = validateHttpUrl(
    typeof req.body?.websiteUrl === 'string' ? req.body.websiteUrl : ''
  );
  if (!urlCheck.ok) {
    return res.status(400).json({
      error: 'validation_error',
      message: urlCheck.message,
    });
  }
  const websiteUrl = urlCheck.value;

  const doc = await BusinessContext.findOne({
    businessId,
    userId: req.devUserId,
  });

  if (!doc) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Business draft not found for this user',
    });
  }

  doc.websiteUrl = websiteUrl;
  await doc.save();

  const scrapeRun = await ScrapeRun.create({
    businessId: doc.businessId,
    userId: req.devUserId,
    websiteUrl,
    status: 'QUEUED',
  });

  const workflowId = `scrape-${scrapeRun._id.toString()}`;
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE || 'setup-run';
  const startedAt = new Date().toISOString();

  try {
    const client = await getTemporalClient();
    await client.workflow.start('scrapeWorkflow', {
      taskQueue,
      workflowId,
      args: [
        {
          scrapeRunId: scrapeRun._id.toString(),
          businessId: doc.businessId.toString(),
          userId: req.devUserId.toString(),
          websiteUrl,
          startedAt,
        },
      ],
    });

    scrapeRun.temporalWorkflowId = workflowId;
    scrapeRun.status = 'RUNNING';
    await scrapeRun.save();

    return res.status(202).json({
      businessId: doc.businessId.toString(),
      websiteUrl,
      scrapeRunId: scrapeRun._id.toString(),
      workflowId,
      status: scrapeRun.status,
    });
  } catch (err) {
    scrapeRun.status = 'FAILED';
    scrapeRun.lastErrorSummary =
      typeof err?.message === 'string' ? err.message : 'Temporal workflow start failed';
    await scrapeRun.save();

    return res.status(503).json({
      error: 'temporal_unavailable',
      message:
        'Scrape was queued but Temporal workflow could not be started. Check Temporal address and worker.',
      businessId: doc.businessId.toString(),
      websiteUrl,
      scrapeRunId: scrapeRun._id.toString(),
      workflowId: null,
      status: scrapeRun.status,
      detail: scrapeRun.lastErrorSummary,
    });
  }
});

router.get('/business/:businessId/scrape-runs/:scrapeRunId', devUserRequired, async (req, res) => {
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
    userId: req.devUserId,
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
    userId: req.devUserId,
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

  return res.status(200).json({
    scrapeRun: {
      id: scrapeRun._id.toString(),
      businessId: scrapeRun.businessId.toString(),
      websiteUrl: scrapeRun.websiteUrl,
      temporalWorkflowId: scrapeRun.temporalWorkflowId ?? null,
      status: scrapeRun.status,
      lastErrorSummary: scrapeRun.lastErrorSummary ?? null,
      suggested,
      createdAt: scrapeRun.createdAt,
      updatedAt: scrapeRun.updatedAt,
    },
  });
});

module.exports = router;
