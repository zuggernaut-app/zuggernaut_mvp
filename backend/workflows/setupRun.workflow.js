'use strict';

const { proxyActivities } = require('@temporalio/workflow');

const { helloActivity } = proxyActivities({
  startToCloseTimeout: '30 seconds',
});

/**
 * Skeleton `SetupRunWorkflow` — wires one activity so Docker + worker can be verified.
 * Replace with full V1 steps (GBP, Ads, GTM, …) in later phases.
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
