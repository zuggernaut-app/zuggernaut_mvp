'use strict';

const { mongoose } = require('../../shared');
require('../../../../backend/models');
const {
  listArtifactsForDiagnosticRun,
} = require('./integrationDiagnosticArtifactService');

const IntegrationDiagnosticRun = mongoose.model('IntegrationDiagnosticRun');

/**
 * @param {import('../../lib/dev/creationDiagnosticResults').CreationDiagnosticRunResult} runResult
 */
async function persistIntegrationDiagnosticRun(runResult) {
  return IntegrationDiagnosticRun.create({
    diagnosticRunId: runResult.diagnosticRunId,
    businessId: runResult.businessId,
    provider: runResult.provider,
    mode: runResult.mode,
    matrixVersion: runResult.matrixVersion,
    ok: runResult.ok,
    startedAt: new Date(runResult.startedAt),
    completedAt: new Date(runResult.completedAt),
    message: runResult.message,
    errorCode: runResult.errorCode ?? undefined,
    steps: runResult.steps,
    summary: runResult.summary,
  });
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {string} diagnosticRunId
 */
async function getIntegrationDiagnosticRun(businessId, diagnosticRunId) {
  const run = await IntegrationDiagnosticRun.findOne({ diagnosticRunId, businessId }).lean();
  if (!run) {
    return null;
  }

  const artifacts = await listArtifactsForDiagnosticRun(diagnosticRunId);

  return {
    diagnosticRunId: run.diagnosticRunId,
    matrixVersion: run.matrixVersion,
    provider: run.provider,
    mode: run.mode,
    businessId: String(run.businessId),
    ok: run.ok,
    startedAt: run.startedAt.toISOString(),
    completedAt: run.completedAt.toISOString(),
    message: run.message,
    errorCode: run.errorCode ?? null,
    steps: run.steps,
    summary: run.summary,
    artifacts: artifacts.map((artifact) => ({
      stepId: artifact.stepId,
      resourceType: artifact.resourceType,
      resourceId: artifact.resourceId,
      resourceName: artifact.resourceName ?? null,
      resourcePath: artifact.resourcePath ?? null,
      externalUrl: artifact.externalUrl ?? null,
      cleanupStatus: artifact.cleanupStatus,
      createdAt: artifact.createdAt,
    })),
  };
}

module.exports = {
  persistIntegrationDiagnosticRun,
  getIntegrationDiagnosticRun,
};
