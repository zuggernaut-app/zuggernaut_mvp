'use strict';

class QaFailureInjectionError extends Error {
  constructor(stepName) {
    super(`QA failure injection triggered for step: ${stepName}`);
    this.name = 'QaFailureInjectionError';
    this.code = 'QA_FAILURE_INJECTION';
    this.stepName = stepName;
  }
}

if (process.env.NODE_ENV === 'production' && process.env.QA_FAILURE_INJECT?.trim()) {
  throw new Error(
    'QA_FAILURE_INJECT is set while NODE_ENV=production. Refusing to start — remove QA_FAILURE_INJECT.'
  );
}

/**
 * @param {string} stepName
 */
function shouldInjectFailure(stepName) {
  const raw = process.env.QA_FAILURE_INJECT?.trim();
  if (!raw) return false;
  const steps = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return steps.includes(stepName);
}

/**
 * @param {string} stepName
 */
function maybeInjectFailure(stepName) {
  if (shouldInjectFailure(stepName)) {
    throw new QaFailureInjectionError(stepName);
  }
}

module.exports = {
  QaFailureInjectionError,
  shouldInjectFailure,
  maybeInjectFailure,
};
