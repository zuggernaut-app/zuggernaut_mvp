'use strict';

const { proxyActivities } = require('@temporalio/workflow');

const { completeSkeletonSetupActivity } = proxyActivities({
  startToCloseTimeout: '30 seconds',
});

/**
 * Skeleton `SetupRunWorkflow` — orchestrates persisted setup steps via activities.
 * The proxied activity name is the Temporal activity type: keep it stable or use versioning;
 * renames break replay for in-flight runs unless you reset dev history or migrate workflows.
 *
 * @param {object} [input]
 * @param {string} [input.setupRunId]
 * @param {string} [input.message]
 * @returns {Promise<{ workflow: 'setupRunWorkflow', greeting: { persisted: boolean, greeting: string, setupRunId: string | null }, setupRunId: string | undefined }>}
 * `greeting` holds the serialized return payload from `completeSkeletonSetupActivity`.
 */
async function setupRunWorkflow(input) {
  const safe = input && typeof input === 'object' ? input : {};
  const greeting = await completeSkeletonSetupActivity({
    setupRunId: safe.setupRunId,
    message: safe.message,
  });
  return { workflow: 'setupRunWorkflow', greeting, setupRunId: safe.setupRunId };
}

module.exports = { setupRunWorkflow };
