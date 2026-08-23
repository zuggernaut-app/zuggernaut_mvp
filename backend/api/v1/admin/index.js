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

router.use(requireAuth, requireAdmin);

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
    .select('businessId businessName userId orgId confirmedAt updatedAt')
    .sort({ updatedAt: -1 })
    .limit(200)
    .lean();
  res.status(200).json({
    businesses: rows.map((bc) => ({
      businessId: bc.businessId.toString(),
      businessName: bc.businessName ?? null,
      userId: bc.userId.toString(),
      orgId: bc.orgId ? bc.orgId.toString() : null,
      confirmedAt: bc.confirmedAt ?? null,
      updatedAt: bc.updatedAt,
    })),
  });
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
