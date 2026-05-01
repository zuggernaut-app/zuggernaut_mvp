'use strict';

/**
 * Minimal activity for validating local Temporal Docker + worker.
 * Later: replace with persisted `SetupStepExecution` + provider capability calls.
 *
 * @param {{ setupRunId?: string, message?: string }} input
 */
async function helloActivity(input) {
  const setupRunId = input?.setupRunId ?? 'unknown-setup-run';
  const msg = input?.message ?? 'hello';
  return `${msg} (SetupRun skeleton; setupRunId=${setupRunId})`;
}

module.exports = { helloActivity };
