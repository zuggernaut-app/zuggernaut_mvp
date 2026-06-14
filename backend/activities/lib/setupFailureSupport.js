'use strict';

const { mergeSetupRunMeta } = require('./setupLifecycle');
const { runSetupRunCompensation } = require('../../services/compensation/setupRunCompensationService');

/**
 * Record support metadata and run idempotent compensation after partial provider failures.
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId} ctx.setupRunId
 * @param {import('mongoose').Types.ObjectId} ctx.businessId
 * @param {string} ctx.failedStep
 * @param {string | undefined} ctx.errorCode
 * @param {import('pino').Logger} ctx.logger
 */
async function recordSetupFailureSupport(ctx) {
  const { setupRunId, businessId, failedStep, errorCode, logger } = ctx;

  const compensation = await runSetupRunCompensation({
    setupRunId,
    businessId,
    failedStep,
    logger,
  });

  await mergeSetupRunMeta(
    setupRunId,
    {
      supportState: {
        failedStep,
        errorCode: errorCode ?? null,
        compensation,
        updatedAt: new Date().toISOString(),
      },
    },
    logger
  );

  return compensation;
}

/**
 * Records recovery metadata for non-failed terminal setup states (snippet pending, tracking fix).
 * @param {object} ctx
 */
async function recordSetupRecoveryState(ctx) {
  const { setupRunId, failedStep, errorCode, summary, logger } = ctx;

  await mergeSetupRunMeta(
    setupRunId,
    {
      supportState: {
        failedStep,
        errorCode: errorCode ?? null,
        summary: summary ?? null,
        updatedAt: new Date().toISOString(),
      },
    },
    logger
  );
}

module.exports = {
  recordSetupFailureSupport,
  recordSetupRecoveryState,
};
