'use strict';

const mongoose = require('mongoose');
const {
  markStepRunning,
  markStepSuccess,
  markStepFailed,
  markStepSkipped,
  mergeSetupRunMeta,
} = require('../activities/lib/setupLifecycle');
const { createLogger } = require('../lib/observability/logger');
const { SETUP_STEP_NAMES } = require('../constants/setupWorkflow');

describe('setup lifecycle helpers', () => {
  const logger = createLogger({ level: 'silent' });

  it('upserts step rows idempotently', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');

    const user = await User.create({ email: 'life@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });
    const setupRunId = run._id;
    const businessId = bc.businessId;

    await markStepRunning({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.LOAD_CONTEXT,
      logger,
    });
    await markStepSuccess({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.LOAD_CONTEXT,
      logger,
    });
    await markStepRunning({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.LOAD_CONTEXT,
      logger,
    });
    await markStepSuccess({
      setupRunId,
      businessId,
      stepName: SETUP_STEP_NAMES.LOAD_CONTEXT,
      logger,
    });

    expect(await SetupStepExecution.countDocuments({ setupRunId })).toBe(1);
  });

  it('failed step sets lastErrorSummary on the step row', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');

    const user = await User.create({ email: 'life2@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });

    await markStepFailed({
      setupRunId: run._id,
      businessId: bc.businessId,
      stepName: 'probe_step',
      summary: 'something broke',
      logger,
    });

    const step = await SetupStepExecution.findOne({ setupRunId: run._id }).lean();
    expect(step.status).toBe('failed');
    expect(step.lastErrorSummary).toBe('something broke');
  });

  it('skipped step sets status skipped with no error summary', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');

    const user = await User.create({ email: 'life-skip@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });

    await markStepSkipped({
      setupRunId: run._id,
      businessId: bc.businessId,
      stepName: SETUP_STEP_NAMES.GBP_AUDIT,
      provider: 'gbp',
      details: { reason: 'gbp_not_connected' },
      logger,
    });

    const step = await SetupStepExecution.findOne({ setupRunId: run._id }).lean();
    expect(step.status).toBe('skipped');
    expect(step.lastErrorSummary).toBeNull();
    expect(step.details).toEqual({ reason: 'gbp_not_connected' });
  });

  it('mergeSetupRunMeta preserves other meta keys', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');

    const user = await User.create({ email: 'life3@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    const run = await SetupRun.create({
      businessId: bc.businessId,
      status: 'RUNNING',
      meta: { a: 1 },
    });

    await mergeSetupRunMeta(run._id, { b: 2 }, logger);

    const row = await SetupRun.findById(run._id).lean();
    expect(row.meta).toEqual({ a: 1, b: 2 });
  });
});
