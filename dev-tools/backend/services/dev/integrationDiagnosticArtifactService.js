'use strict';

const crypto = require('crypto');
const { mongoose } = require('../../shared');
require('../../../../backend/models');
const { isCreationDiagnosticProvider } = require('../../lib/dev/creationDiagnosticsMatrix');
const { normalizeCreationDiagnosticRunMode } = require('../../lib/dev/creationDiagnosticResults');

const IntegrationDiagnosticArtifact = mongoose.model('IntegrationDiagnosticArtifact');

/**
 * @returns {string}
 */
function createDiagnosticRunId() {
  return crypto.randomUUID();
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {object} payload
 * @param {'google_ads' | 'gtm'} payload.provider
 * @param {string} payload.diagnosticRunId
 * @param {string} payload.stepId
 * @param {string} payload.action
 * @param {string} payload.mode
 * @param {string} payload.resourceType
 * @param {string} payload.resourceId
 * @param {string} [payload.resourceName]
 * @param {string} [payload.resourcePath]
 * @param {string} [payload.externalUrl]
 * @param {object} [payload.metadata]
 * @param {string} [payload.cleanupStatus]
 */
async function recordIntegrationDiagnosticArtifact(businessId, payload) {
  const {
    provider,
    diagnosticRunId,
    stepId,
    action,
    mode,
    resourceType,
    resourceId,
    resourceName,
    resourcePath,
    externalUrl,
    metadata,
    cleanupStatus,
  } = payload;

  if (!isCreationDiagnosticProvider(provider)) {
    throw new Error(`Unsupported creation diagnostic provider: ${provider}`);
  }

  const normalizedMode = normalizeCreationDiagnosticRunMode(provider, mode);

  if (!diagnosticRunId?.trim()) {
    throw new Error('diagnosticRunId is required.');
  }
  if (!stepId?.trim()) {
    throw new Error('stepId is required.');
  }
  if (!action?.trim()) {
    throw new Error('action is required.');
  }
  if (!resourceType?.trim()) {
    throw new Error('resourceType is required.');
  }
  if (!resourceId?.trim()) {
    throw new Error('resourceId is required.');
  }

  return IntegrationDiagnosticArtifact.create({
    businessId,
    provider,
    diagnosticRunId: diagnosticRunId.trim(),
    stepId: stepId.trim(),
    action: action.trim(),
    mode: normalizedMode,
    resourceType: resourceType.trim(),
    resourceId: resourceId.trim(),
    resourceName: resourceName?.trim() || undefined,
    resourcePath: resourcePath?.trim() || undefined,
    externalUrl: externalUrl?.trim() || undefined,
    metadata: metadata ?? undefined,
    cleanupStatus: cleanupStatus ?? undefined,
  });
}

/**
 * @param {string} diagnosticRunId
 * @returns {Promise<import('mongoose').Document[]>}
 */
async function listArtifactsForDiagnosticRun(diagnosticRunId) {
  return IntegrationDiagnosticArtifact.find({ diagnosticRunId }).sort({ createdAt: 1 }).lean();
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {{ provider?: string }} [options]
 * @returns {Promise<import('mongoose').LeanDocument[]>}
 */
async function listArtifactsForBusiness(businessId, options = {}) {
  const query = { businessId };
  if (options.provider) {
    if (!isCreationDiagnosticProvider(options.provider)) {
      throw new Error(`Unsupported creation diagnostic provider: ${options.provider}`);
    }
    query.provider = options.provider;
  }

  return IntegrationDiagnosticArtifact.find(query).sort({ createdAt: -1 }).lean();
}

module.exports = {
  createDiagnosticRunId,
  recordIntegrationDiagnosticArtifact,
  listArtifactsForDiagnosticRun,
  listArtifactsForBusiness,
};
