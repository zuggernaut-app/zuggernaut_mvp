'use strict';

const { ARTIFACT_TYPES } = require('../../../../backend/constants/enums');
const {
  CREATION_DIAGNOSTIC_MATRIX_VERSION,
  CREATION_DIAGNOSTIC_PROVIDERS,
  CREATION_DIAGNOSTIC_STEPS_BY_PROVIDER,
} = require('../../constants/creationDiagnostics');

/**
 * @typedef {import('../../constants/creationDiagnostics').GOOGLE_ADS_CREATION_DIAGNOSTIC_STEPS[number]} CreationDiagnosticStep
 */

/**
 * @param {string} provider
 * @returns {provider is 'google_ads' | 'gtm'}
 */
function isCreationDiagnosticProvider(provider) {
  return CREATION_DIAGNOSTIC_PROVIDERS.includes(provider);
}

/**
 * @param {string} provider
 * @returns {readonly CreationDiagnosticStep[]}
 */
function getCreationDiagnosticSteps(provider) {
  if (!isCreationDiagnosticProvider(provider)) {
    throw new Error(
      `Unsupported creation diagnostic provider: ${provider}. Use one of: ${CREATION_DIAGNOSTIC_PROVIDERS.join(', ')}`
    );
  }
  return CREATION_DIAGNOSTIC_STEPS_BY_PROVIDER[provider];
}

/**
 * @param {string} provider
 * @param {string} stepId
 * @returns {CreationDiagnosticStep | null}
 */
function getCreationDiagnosticStep(provider, stepId) {
  return getCreationDiagnosticSteps(provider).find((step) => step.id === stepId) ?? null;
}

/**
 * Ordered checklist labels for docs, UI, and trace output.
 *
 * @param {string} provider
 * @returns {{ version: string, provider: string, totalSteps: number, requiredSteps: number, steps: Array<{ order: number, id: string, label: string, required: boolean, group: string | null }> }}
 */
function getCreationDiagnosticMatrixSummary(provider) {
  const steps = getCreationDiagnosticSteps(provider);
  return {
    version: CREATION_DIAGNOSTIC_MATRIX_VERSION,
    provider,
    totalSteps: steps.length,
    requiredSteps: steps.filter((step) => step.required).length,
    steps: steps.map((step) => ({
      order: step.order,
      id: step.id,
      label: step.label,
      required: step.required,
      group: step.group ?? null,
    })),
  };
}

/**
 * Validates matrix integrity — call in tests and before wiring execution services.
 *
 * @returns {{ ok: true } | { ok: false, errors: string[] }}
 */
function validateCreationDiagnosticMatrix() {
  const errors = [];
  const artifactTypeSet = new Set(ARTIFACT_TYPES);

  for (const provider of CREATION_DIAGNOSTIC_PROVIDERS) {
    const steps = CREATION_DIAGNOSTIC_STEPS_BY_PROVIDER[provider];
    const ids = new Set();
    const orders = [];

    for (const step of steps) {
      if (step.provider !== provider) {
        errors.push(`${provider}: step ${step.id} has mismatched provider ${step.provider}`);
      }
      if (ids.has(step.id)) {
        errors.push(`${provider}: duplicate step id ${step.id}`);
      }
      ids.add(step.id);
      orders.push(step.order);

      if (!artifactTypeSet.has(step.resourceType)) {
        errors.push(
          `${provider}: step ${step.id} references unknown artifactType ${step.resourceType}`
        );
      }
    }

    for (const step of steps) {
      for (const prereq of step.prerequisites) {
        if (!ids.has(prereq)) {
          errors.push(`${provider}: step ${step.id} prerequisite ${prereq} is not defined`);
        }
      }
    }

    const sortedOrders = [...orders].sort((a, b) => a - b);
    if (sortedOrders.length !== steps.length) {
      errors.push(`${provider}: step order list is empty or invalid`);
    } else {
      for (let i = 0; i < sortedOrders.length; i += 1) {
        if (sortedOrders[i] !== i + 1) {
          errors.push(
            `${provider}: step orders must be contiguous 1..N (expected ${i + 1}, got ${sortedOrders[i]})`
          );
          break;
        }
      }
    }

    for (const step of steps) {
      for (const prereq of step.prerequisites) {
        const prereqStep = steps.find((s) => s.id === prereq);
        if (prereqStep && prereqStep.order >= step.order) {
          errors.push(
            `${provider}: step ${step.id} prerequisite ${prereq} must run earlier (order ${prereqStep.order} >= ${step.order})`
          );
        }
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

module.exports = {
  CREATION_DIAGNOSTIC_MATRIX_VERSION,
  CREATION_DIAGNOSTIC_PROVIDERS,
  isCreationDiagnosticProvider,
  getCreationDiagnosticSteps,
  getCreationDiagnosticStep,
  getCreationDiagnosticMatrixSummary,
  validateCreationDiagnosticMatrix,
};
