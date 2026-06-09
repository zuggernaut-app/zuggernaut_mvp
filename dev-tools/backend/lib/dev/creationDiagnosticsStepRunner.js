'use strict';

const {
  shouldSkipStepForRunMode,
  buildSkippedCreationDiagnosticStepResult,
  buildCreationDiagnosticStepResult,
} = require('./creationDiagnosticResults');

/**
 * @param {{ id: string, prerequisites: string[] }} matrixStep
 * @param {Map<string, { ok: boolean, skipped: boolean }>} stepResultsById
 * @returns {boolean}
 */
function prerequisitesMet(matrixStep, stepResultsById) {
  for (const prereq of matrixStep.prerequisites) {
    const prior = stepResultsById.get(prereq);
    if (!prior || (!prior.ok && !prior.skipped)) {
      return false;
    }
  }
  return true;
}

/**
 * @param {object} matrixStep
 * @param {Map<string, object>} stepResultsById
 * @param {string} mode
 * @returns {object | null}
 */
function buildPrerequisiteBlockedStepResult(matrixStep, stepResultsById, mode) {
  if (prerequisitesMet(matrixStep, stepResultsById)) {
    return null;
  }

  const blockedBy = matrixStep.prerequisites.find((prereq) => {
    const prior = stepResultsById.get(prereq);
    return !prior || (!prior.ok && !prior.skipped);
  });

  return buildSkippedCreationDiagnosticStepResult(matrixStep, {
    mode,
    message: `Skipped because prerequisite step "${blockedBy}" did not complete successfully.`,
  });
}

/**
 * @param {object} input
 * @param {object} input.matrixStep
 * @param {string} input.mode
 * @param {Map<string, object>} input.stepResultsById
 * @param {() => Promise<object>} input.execute
 * @returns {Promise<object>}
 */
async function runCreationDiagnosticStep(input) {
  const { matrixStep, mode, stepResultsById, execute } = input;

  const blocked = buildPrerequisiteBlockedStepResult(matrixStep, stepResultsById, mode);
  if (blocked) {
    return blocked;
  }

  if (shouldSkipStepForRunMode(mode, matrixStep)) {
    return buildSkippedCreationDiagnosticStepResult(matrixStep, { mode });
  }

  try {
    return await execute();
  } catch (err) {
    const errorCode = typeof err?.code === 'string' ? err.code : 'CREATION_DIAGNOSTIC_STEP_FAILED';
    return buildCreationDiagnosticStepResult({
      matrixStep,
      ok: false,
      skipped: false,
      message: err instanceof Error ? err.message : 'Creation diagnostic step failed.',
      errorCode,
      details: err?.details ?? undefined,
    });
  }
}

module.exports = {
  prerequisitesMet,
  buildPrerequisiteBlockedStepResult,
  runCreationDiagnosticStep,
};
