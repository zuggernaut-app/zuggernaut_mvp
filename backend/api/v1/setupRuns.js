'use strict';

const express = require('express');
const mongoose = require('mongoose');
const BusinessContext = mongoose.model('BusinessContext');
const SetupRun = mongoose.model('SetupRun');
const SetupStepExecution = mongoose.model('SetupStepExecution');
const { requireAuth } = require('./middleware/requireAuth');
const { getTemporalClient } = require('../../lib/temporalClient');

const router = express.Router();

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

  const bc = await BusinessContext.findOne({
    businessId,
    userId,
  }).lean();

  if (!bc) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Business context not found for this user',
    });
  }

  if (!bc.confirmedAt) {
    return res.status(409).json({
      error: 'precondition_failed',
      message:
        'Business context must be confirmed (PUT /business-contexts/:businessId) before starting setup.',
    });
  }

  const setupRun = await SetupRun.create({
    businessId,
    status: 'USER_INPUT_COLLECTED',
  });

  const workflowId = `setup-run-${setupRun._id.toString()}`;
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE || 'setup-run';

  try {
    const client = await getTemporalClient();
    await client.workflow.start('setupRunWorkflow', {
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

    const ownsBusiness = await BusinessContext.exists({
      businessId: setupRun.businessId,
      userId: setupUserId,
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

    return res.status(200).json({
      setupRun: {
        id: setupRun._id.toString(),
        businessId: setupRun.businessId.toString(),
        temporalWorkflowId: setupRun.temporalWorkflowId ?? null,
        status: setupRun.status,
        lastErrorSummary: setupRun.lastErrorSummary ?? null,
        meta: setupRun.meta ?? null,
        createdAt: setupRun.createdAt,
        updatedAt: setupRun.updatedAt,
      },
      steps: steps.map((s) => ({
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
