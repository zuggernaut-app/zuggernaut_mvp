'use strict';

const mongoose = require('mongoose');
const { completeSkeletonSetupActivity } = require('../activities/completeSkeletonSetup');

describe('completeSkeletonSetupActivity', () => {
  it('skips persistence for invalid setupRunId', async () => {
    const res = await completeSkeletonSetupActivity({
      setupRunId: 'not-an-object-id',
      message: 'hello',
    });

    expect(res.persisted).toBe(false);
    expect(res.setupRunId).toBe('not-an-object-id');
  });

  it('throws non-retryable failure when SetupRun row is missing', async () => {
    const missingId = new mongoose.Types.ObjectId().toString();

    await expect(completeSkeletonSetupActivity({ setupRunId: missingId })).rejects.toMatchObject({
      type: 'SetupRunNotFoundInWorkerDb',
    });
  });

  it('marks SetupRun succeeded and upserts skeleton step', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');

    const user = await User.create({ email: 'act@test.com' });
    const bc = await BusinessContext.create({ userId: user._id });
    const run = await SetupRun.create({
      businessId: bc.businessId,
      status: 'RUNNING',
    });

    const res = await completeSkeletonSetupActivity({
      setupRunId: run._id.toString(),
      message: 'probe',
    });

    expect(res.persisted).toBe(true);

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.status).toBe('SUCCEEDED');

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: 'worker_verification',
    }).lean();

    expect(step.status).toBe('success');

    await completeSkeletonSetupActivity({
      setupRunId: run._id.toString(),
      message: 'again',
    });

    const steps = await SetupStepExecution.countDocuments({ setupRunId: run._id });
    expect(steps).toBe(1);
  });

  it('marks SetupRun FAILED when step persistence throws', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');

    const user = await User.create({ email: 'persist-fail@test.com' });
    const bc = await BusinessContext.create({ userId: user._id });
    const run = await SetupRun.create({
      businessId: bc.businessId,
      status: 'RUNNING',
    });

    const spy = jest
      .spyOn(SetupStepExecution, 'findOneAndUpdate')
      .mockRejectedValueOnce(new Error('disk full'));

    await expect(
      completeSkeletonSetupActivity({ setupRunId: run._id.toString(), message: 'x' }),
    ).rejects.toMatchObject({ type: 'SetupRunPersistenceError' });

    spy.mockRestore();

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.status).toBe('FAILED');
    expect(updated.lastErrorSummary).toContain('disk full');
  });
});
