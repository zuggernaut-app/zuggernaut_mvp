'use strict';

const { proxyActivities } = require('@temporalio/workflow');

const { helloActivity } = proxyActivities({
  startToCloseTimeout: '30 seconds',
});

/**
 * Skeleton `SetupRunWorkflow` — wires one activity so Docker + worker can be verified.
 * Activity is named `helloActivity` for Temporal determinism: earlier runs logged that type in history;
 * renames would break replay / queries (TMPRL1100). Impl is persisted setup (see activities/index).
 *
 * @param {object} [input]
 * @param {string} [input.setupRunId]
 * @param {string} [input.message]
 */
async function setupRunWorkflow(input) {
  const safe = input && typeof input === 'object' ? input : {};
  const greeting = await helloActivity({
    setupRunId: safe.setupRunId,
    message: safe.message,
  });
  return { workflow: 'setupRunWorkflow', greeting, setupRunId: safe.setupRunId };
}

module.exports = { setupRunWorkflow };
