'use strict';

const DEFAULT_STUCK_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * @param {object} setupRun — lean SetupRun with status and timestamps
 * @param {number} [now]
 * @param {number} [thresholdMs]
 */
function detectStuckSetupRun(setupRun, now = Date.now(), thresholdMs = DEFAULT_STUCK_THRESHOLD_MS) {
  if (!setupRun || setupRun.status !== 'RUNNING') {
    return {
      stuck: false,
      runningForMs: null,
      thresholdMs,
      guidance: null,
    };
  }

  const updatedAt = setupRun.updatedAt ? new Date(setupRun.updatedAt).getTime() : null;
  const createdAt = setupRun.createdAt ? new Date(setupRun.createdAt).getTime() : null;
  const since = updatedAt ?? createdAt ?? now;
  const runningForMs = Math.max(0, now - since);
  const stuck = runningForMs >= thresholdMs;

  return {
    stuck,
    runningForMs,
    thresholdMs,
    guidance: stuck
      ? 'Verify the Temporal worker is running, MongoDB is reachable, and inspect the workflow in Temporal UI.'
      : null,
  };
}

module.exports = {
  detectStuckSetupRun,
  DEFAULT_STUCK_THRESHOLD_MS,
};
