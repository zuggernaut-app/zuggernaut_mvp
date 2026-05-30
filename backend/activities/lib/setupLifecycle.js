'use strict';

const mongoose = require('mongoose');
const { Context } = require('@temporalio/activity');
const SetupStepExecution = mongoose.model('SetupStepExecution');
const SetupRun = mongoose.model('SetupRun');

function activityAttempt() {
  try {
    return Context.current().info.attempt;
  } catch {
    return 1;
  }
}

function baseLogFields(setupRunId, businessId, stepName, provider) {
  const o = { setupRunId, stepName };
  if (businessId != null) o.businessId = String(businessId);
  if (provider) o.provider = provider;
  return o;
}

/**
 * @param {object} p
 * @param {import('mongoose').Types.ObjectId} p.setupRunId
 * @param {import('mongoose').Types.ObjectId} p.businessId
 * @param {string} p.stepName
 * @param {string} [p.provider]
 * @param {import('pino').Logger} p.logger
 */
async function markStepRunning({ setupRunId, businessId, stepName, provider, logger }) {
  const attempt = activityAttempt();
  const now = new Date();
  await SetupStepExecution.findOneAndUpdate(
    { setupRunId, stepName },
    {
      $set: {
        setupRunId,
        businessId,
        stepName,
        status: 'running',
        startedAt: now,
        lastErrorSummary: null,
        ...(provider ? { provider } : {}),
        attemptCount: attempt,
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
  logger.info(baseLogFields(setupRunId.toString(), businessId, stepName, provider), 'step running');
}

async function markStepSuccess({ setupRunId, businessId, stepName, provider, details, logger }) {
  const now = new Date();
  await SetupStepExecution.findOneAndUpdate(
    { setupRunId, stepName },
    {
      $set: {
        setupRunId,
        businessId,
        stepName,
        status: 'success',
        endedAt: now,
        lastErrorSummary: null,
        ...(provider ? { provider } : {}),
        ...(details !== undefined ? { details } : {}),
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
  logger.info(baseLogFields(setupRunId.toString(), businessId, stepName, provider), 'step success');
}

async function markStepFailed({ setupRunId, businessId, stepName, provider, summary, details, logger }) {
  const now = new Date();
  const attempt = activityAttempt();
  const text = typeof summary === 'string' ? summary : 'Step failed';
  await SetupStepExecution.findOneAndUpdate(
    { setupRunId, stepName },
    {
      $set: {
        setupRunId,
        businessId,
        stepName,
        status: 'failed',
        endedAt: now,
        lastErrorSummary: text,
        ...(provider ? { provider } : {}),
        ...(details !== undefined ? { details } : {}),
        attemptCount: attempt,
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
  logger.warn(
    {
      ...baseLogFields(setupRunId.toString(), businessId, stepName, provider),
      summary: text,
      attempt,
      ...(details && typeof details === 'object' && details.code ? { errorCode: details.code } : {}),
    },
    'step failed'
  );
}

async function markStepSkipped({ setupRunId, businessId, stepName, provider, details, logger }) {
  const now = new Date();
  await SetupStepExecution.findOneAndUpdate(
    { setupRunId, stepName },
    {
      $set: {
        setupRunId,
        businessId,
        stepName,
        status: 'skipped',
        endedAt: now,
        lastErrorSummary: null,
        ...(provider ? { provider } : {}),
        ...(details !== undefined ? { details } : {}),
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
  logger.info(baseLogFields(setupRunId.toString(), businessId, stepName, provider), 'step skipped');
}

async function patchSetupRun(setupRunId, patch, logger) {
  await SetupRun.updateOne({ _id: setupRunId }, { $set: patch });
  logger.info({ setupRunId: setupRunId.toString(), keys: Object.keys(patch) }, 'setup run patched');
}

/**
 * Shallow merge into SetupRun.meta without replacing unrelated meta keys.
 * @param {import('mongoose').Types.ObjectId} setupRunId
 * @param {Record<string, unknown>} fragment
 */
async function mergeSetupRunMeta(setupRunId, fragment, logger) {
  const $set = {};
  for (const [k, v] of Object.entries(fragment)) {
    $set[`meta.${k}`] = v;
  }
  await SetupRun.updateOne({ _id: setupRunId }, { $set });
  logger.info(
    { setupRunId: setupRunId.toString(), metaKeys: Object.keys(fragment) },
    'setup run meta merged'
  );
}

module.exports = {
  activityAttempt,
  baseLogFields,
  markStepRunning,
  markStepSuccess,
  markStepFailed,
  markStepSkipped,
  patchSetupRun,
  mergeSetupRunMeta,
};
