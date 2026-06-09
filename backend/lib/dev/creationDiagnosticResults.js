'use strict';

const { CREATION_DIAGNOSTIC_RUN_MODES } = require('../../constants/enums');
const {
  CREATION_DIAGNOSTIC_MATRIX_VERSION,
  CREATION_DIAGNOSTIC_PROVIDERS,
  CREATION_DIAGNOSTIC_SAFETY,
  DEFAULT_CREATION_DIAGNOSTIC_RUN_MODE_BY_PROVIDER,
  GTM_PUBLISH_STEP_IDS,
} = require('../../constants/creationDiagnostics');
const { isCreationDiagnosticProvider } = require('./creationDiagnosticsMatrix');

/**
 * @typedef {object} CreationDiagnosticStepResult
 * @property {string} name — stable step id from the matrix
 * @property {'google_ads' | 'gtm'} provider
 * @property {string} action — matrix action handler id
 * @property {boolean} ok
 * @property {boolean} skipped
 * @property {string} resourceType
 * @property {string} [resourceId]
 * @property {string} [resourceName]
 * @property {string} message
 * @property {string} [errorCode]
 * @property {object} [details]
 */

/**
 * @typedef {object} CreationDiagnosticRunResult
 * @property {string} diagnosticRunId
 * @property {string} matrixVersion
 * @property {'google_ads' | 'gtm'} provider
 * @property {string} mode
 * @property {string} businessId
 * @property {boolean} ok
 * @property {string} startedAt — ISO-8601
 * @property {string} completedAt — ISO-8601
 * @property {string} message
 * @property {string} [errorCode]
 * @property {CreationDiagnosticStepResult[]} steps
 * @property {{ total: number, passed: number, failed: number, skipped: number }} summary
 */

/**
 * @param {string} provider
 * @param {string} [mode]
 * @returns {string}
 */
function normalizeCreationDiagnosticRunMode(provider, mode) {
  if (!isCreationDiagnosticProvider(provider)) {
    throw new Error(
      `Unsupported creation diagnostic provider: ${provider}. Use one of: ${CREATION_DIAGNOSTIC_PROVIDERS.join(', ')}`
    );
  }

  const resolved = (mode || DEFAULT_CREATION_DIAGNOSTIC_RUN_MODE_BY_PROVIDER[provider] || '').trim();
  if (!CREATION_DIAGNOSTIC_RUN_MODES.includes(resolved)) {
    throw new Error(
      `Unsupported creation diagnostic mode: ${resolved}. Use one of: ${CREATION_DIAGNOSTIC_RUN_MODES.join(', ')}`
    );
  }

  if (provider === 'google_ads' && resolved === 'create_and_publish') {
    throw new Error('create_and_publish is only supported for GTM creation diagnostics.');
  }

  return resolved;
}

/**
 * @param {string} provider
 * @returns {string}
 */
function getDefaultCreationDiagnosticRunMode(provider) {
  return normalizeCreationDiagnosticRunMode(provider);
}

/**
 * @param {string} mode
 * @param {{ id: string, provider: string }} step
 * @returns {boolean}
 */
function shouldSkipStepForRunMode(mode, step) {
  if (mode === 'validate_only') {
    return true;
  }

  if (
    step.provider === 'gtm' &&
    GTM_PUBLISH_STEP_IDS.includes(step.id) &&
    mode !== 'create_and_publish'
  ) {
    return true;
  }

  return false;
}

/**
 * @param {string} mode
 * @param {{ id: string, provider: string }} step
 * @returns {string}
 */
function getRunModeSkipMessage(mode, step) {
  if (mode === 'validate_only') {
    return 'Skipped in validate_only mode (no external resources are created).';
  }

  if (
    step.provider === 'gtm' &&
    GTM_PUBLISH_STEP_IDS.includes(step.id) &&
    mode !== 'create_and_publish'
  ) {
    return 'Skipped in create_paused mode; enable create_and_publish to publish GTM versions.';
  }

  return 'Skipped for the selected run mode.';
}

/**
 * @param {object} matrixStep
 * @param {object} [overrides]
 * @returns {CreationDiagnosticStepResult}
 */
function buildSkippedCreationDiagnosticStepResult(matrixStep, overrides = {}) {
  const message =
    overrides.message ??
    matrixStep.skipWhen ??
    getRunModeSkipMessage(overrides.mode ?? 'create_paused', matrixStep);

  return buildCreationDiagnosticStepResult({
    matrixStep,
    ok: true,
    skipped: true,
    message,
    ...overrides,
  });
}

/**
 * @param {object} input
 * @param {object} input.matrixStep
 * @param {boolean} input.ok
 * @param {boolean} [input.skipped]
 * @param {string} input.message
 * @param {string} [input.errorCode]
 * @param {string} [input.resourceId]
 * @param {string} [input.resourceName]
 * @param {object} [input.details]
 * @returns {CreationDiagnosticStepResult}
 */
function buildCreationDiagnosticStepResult(input) {
  const { matrixStep, ok, skipped = false, message, errorCode, resourceId, resourceName, details } =
    input;

  if (!matrixStep?.id || !matrixStep?.provider || !matrixStep?.action || !matrixStep?.resourceType) {
    throw new Error('matrixStep must include id, provider, action, and resourceType.');
  }

  const result = {
    name: matrixStep.id,
    provider: matrixStep.provider,
    action: matrixStep.action,
    ok: Boolean(ok),
    skipped: Boolean(skipped),
    resourceType: matrixStep.resourceType,
    message: String(message),
  };

  if (resourceId != null && String(resourceId).trim()) {
    result.resourceId = String(resourceId).trim();
  }
  if (resourceName != null && String(resourceName).trim()) {
    result.resourceName = String(resourceName).trim();
  }
  if (errorCode != null && String(errorCode).trim()) {
    result.errorCode = String(errorCode).trim();
  }
  if (details != null && typeof details === 'object') {
    result.details = details;
  }

  validateCreationDiagnosticStepResult(result);
  return result;
}

/**
 * @param {CreationDiagnosticStepResult} result
 * @returns {CreationDiagnosticStepResult}
 */
function validateCreationDiagnosticStepResult(result) {
  const required = ['name', 'provider', 'action', 'ok', 'skipped', 'resourceType', 'message'];
  for (const key of required) {
    if (result[key] === undefined) {
      throw new Error(`Creation diagnostic step result missing required field: ${key}`);
    }
  }

  if (!isCreationDiagnosticProvider(result.provider)) {
    throw new Error(`Invalid creation diagnostic provider on step result: ${result.provider}`);
  }

  if (result.skipped && !result.ok) {
    throw new Error('Skipped creation diagnostic steps must report ok=true.');
  }

  if (!result.ok && !result.skipped && !result.errorCode) {
    throw new Error('Failed creation diagnostic steps must include errorCode.');
  }

  return result;
}

/**
 * @param {CreationDiagnosticStepResult[]} steps
 * @returns {{ total: number, passed: number, failed: number, skipped: number }}
 */
function summarizeCreationDiagnosticSteps(steps) {
  const summary = { total: steps.length, passed: 0, failed: 0, skipped: 0 };

  for (const step of steps) {
    if (step.skipped) {
      summary.skipped += 1;
      continue;
    }
    if (step.ok) {
      summary.passed += 1;
    } else {
      summary.failed += 1;
    }
  }

  return summary;
}

/**
 * @param {object} input
 * @param {string} input.diagnosticRunId
 * @param {'google_ads' | 'gtm'} input.provider
 * @param {string} input.mode
 * @param {string} input.businessId
 * @param {string} input.startedAt
 * @param {string} input.completedAt
 * @param {CreationDiagnosticStepResult[]} input.steps
 * @param {string} [input.message]
 * @param {string} [input.errorCode]
 * @param {boolean} [input.ok] — override when run fails before any matrix step executes
 * @returns {CreationDiagnosticRunResult}
 */
function buildCreationDiagnosticRunResult(input) {
  const {
    diagnosticRunId,
    provider,
    mode,
    businessId,
    startedAt,
    completedAt,
    steps,
    message,
    errorCode,
    ok: okOverride,
  } = input;

  const summary = summarizeCreationDiagnosticSteps(steps);
  const ok = okOverride !== undefined ? Boolean(okOverride) : summary.failed === 0;

  const result = {
    diagnosticRunId: String(diagnosticRunId),
    matrixVersion: CREATION_DIAGNOSTIC_MATRIX_VERSION,
    provider,
    mode: normalizeCreationDiagnosticRunMode(provider, mode),
    businessId: String(businessId),
    ok,
    startedAt: String(startedAt),
    completedAt: String(completedAt),
    message:
      message ??
      (ok
        ? 'Creation diagnostics completed successfully.'
        : 'Creation diagnostics completed with failures.'),
    steps,
    summary,
  };

  if (!ok && errorCode) {
    result.errorCode = String(errorCode);
  } else if (!ok) {
    const firstFailure = steps.find((step) => !step.ok && !step.skipped);
    if (firstFailure?.errorCode) {
      result.errorCode = firstFailure.errorCode;
    }
  }

  return result;
}

/**
 * @param {object} input
 * @param {string} input.businessId
 * @param {string} input.stepId
 * @param {string} [input.suffix]
 * @returns {string}
 */
function buildDiagnosticResourceLabel({ businessId, stepId, suffix }) {
  const shortBusinessId = String(businessId).slice(-8);
  const timeSuffix = suffix || new Date().toISOString().replace(/[:.]/g, '-');
  return `${CREATION_DIAGNOSTIC_SAFETY.RESOURCE_NAME_PREFIX}${stepId}_${shortBusinessId}_${timeSuffix}`;
}

module.exports = {
  CREATION_DIAGNOSTIC_SAFETY,
  normalizeCreationDiagnosticRunMode,
  getDefaultCreationDiagnosticRunMode,
  shouldSkipStepForRunMode,
  getRunModeSkipMessage,
  buildSkippedCreationDiagnosticStepResult,
  buildCreationDiagnosticStepResult,
  validateCreationDiagnosticStepResult,
  summarizeCreationDiagnosticSteps,
  buildCreationDiagnosticRunResult,
  buildDiagnosticResourceLabel,
};
