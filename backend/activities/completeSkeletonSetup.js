'use strict';

const mongoose = require('mongoose');
const { ApplicationFailure } = require('@temporalio/activity');

const SetupRun = mongoose.model('SetupRun');
const SetupStepExecution = mongoose.model('SetupStepExecution');

const SKELETON_STEP_NAME = 'worker_verification';

function redactMongoUri(uri) {
  return typeof uri === 'string' ? uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@') : '';
}

/**
 * Persists MVP skeleton outcomes: one step row + terminal SetupRun status.
 * Skips writes only when setupRunId is missing or not a valid ObjectId (CLI demos).
 * A valid ObjectId with no SetupRun row fails the workflow (usually worker DB ≠ API DB).
 *
 * @param {{ setupRunId?: string, message?: string }} input
 */
async function completeSkeletonSetupActivity(input) {
  const rawId = typeof input?.setupRunId === 'string' ? input.setupRunId.trim() : '';
  const msg = typeof input?.message === 'string' ? input.message : 'setup-started';

  if (!rawId || !mongoose.Types.ObjectId.isValid(rawId)) {
    return {
      persisted: false,
      greeting: `${msg} (skipped persistence: invalid setupRunId)`,
      setupRunId: rawId || null,
    };
  }

  const setupRunId = new mongoose.Types.ObjectId(rawId);
  const run = await SetupRun.findById(setupRunId).lean();
  if (!run) {
    const hint = redactMongoUri(process.env.MONGODB_URI || 'mongodb://localhost:27017/zuggernaut_test');
    throw ApplicationFailure.nonRetryable(
      `SetupRun ${rawId} not found in worker MongoDB. Use the same MONGODB_URI in backend/.env for both API server and Temporal worker (worker uses: ${hint}).`,
      'SetupRunNotFoundInWorkerDb'
    );
  }

  const now = new Date();

  try {
    await SetupStepExecution.findOneAndUpdate(
      { setupRunId, stepName: SKELETON_STEP_NAME },
      {
        $set: {
          setupRunId,
          stepName: SKELETON_STEP_NAME,
          businessId: run.businessId,
          status: 'success',
          attemptCount: 1,
          startedAt: now,
          endedAt: now,
          details: { message: msg, skeleton: true },
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );

    await SetupRun.updateOne(
      { _id: setupRunId },
      { $set: { status: 'SUCCEEDED', lastErrorSummary: null } }
    );

    return {
      persisted: true,
      greeting: `${msg} (SetupRun ${rawId} marked SUCCEEDED)`,
      setupRunId: rawId,
    };
  } catch (err) {
    const summary = typeof err?.message === 'string' ? err.message : 'Persistence failed';
    await SetupRun.updateOne(
      { _id: setupRunId },
      { $set: { status: 'FAILED', lastErrorSummary: summary } }
    ).catch(() => {});

    throw ApplicationFailure.nonRetryable(summary, 'SetupRunPersistenceError');
  }
}

module.exports = { completeSkeletonSetupActivity };
