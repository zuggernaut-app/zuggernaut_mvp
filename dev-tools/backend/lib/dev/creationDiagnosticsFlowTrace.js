'use strict';

const {
  isCreationDiagnosticProvider,
  getCreationDiagnosticMatrixSummary,
} = require('./creationDiagnosticsMatrix');
const {
  getDefaultCreationDiagnosticRunMode,
  normalizeCreationDiagnosticRunMode,
  CREATION_DIAGNOSTIC_SAFETY,
} = require('./creationDiagnosticResults');
const { assertCreationDiagnosticConnection } = require('./assertCreationDiagnosticConnection');
const { runGtmCreationDiagnostics } = require('../../services/dev/gtmCreationDiagnosticsService');
const { runGoogleAdsCreationDiagnostics } = require('../../services/dev/googleAdsCreationDiagnosticsService');
const { listArtifactsForDiagnosticRun } = require('../../services/dev/integrationDiagnosticArtifactService');
const { traceBusinessContext } = require('./devIntegrationsFlowTrace');

const CREATION_DIAGNOSTIC_TRACE_PROVIDERS = ['google_ads', 'gtm'];

/**
 * @param {string} [provider]
 * @returns {'google_ads' | 'gtm'}
 */
function normalizeCreationDiagnosticTraceProvider(provider) {
  const value = (provider || 'google_ads').trim();
  if (!isCreationDiagnosticProvider(value)) {
    throw new Error(
      `Creation diagnostics trace supports: ${CREATION_DIAGNOSTIC_TRACE_PROVIDERS.join(', ')} (not gbp). Use --provider google_ads or --provider gtm.`
    );
  }
  return value;
}

/**
 * @param {string} label
 * @param {boolean} ok
 * @param {object} [extra]
 */
function stageResult(label, ok, extra = {}) {
  return {
    id: extra.id ?? label.toLowerCase().replace(/\s+/g, '_'),
    label,
    ok,
    ...extra,
  };
}

/**
 * @param {'google_ads' | 'gtm'} provider
 */
function traceCreationDiagnosticsEnvironment(provider) {
  const gtmMock = process.env.GTM_API_MOCK === 'true';
  const adsMock = process.env.GOOGLE_ADS_API_MOCK === 'true';

  return stageResult('Creation diagnostics environment', true, {
    id: 'creation_environment',
    detail: `provider=${provider}, gtmApiMock=${gtmMock}, googleAdsApiMock=${adsMock}`,
    data: {
      provider,
      gtmApiMock: gtmMock,
      gtmApiEnabled: process.env.GTM_API_ENABLED === 'true',
      googleAdsApiMock: adsMock,
      googleAdsApiEnabled: process.env.GOOGLE_ADS_API_ENABLED === 'true',
      resourceNamePrefix: CREATION_DIAGNOSTIC_SAFETY.RESOURCE_NAME_PREFIX,
      separateFromTemporal: CREATION_DIAGNOSTIC_SAFETY.SEPARATE_FROM_TEMPORAL,
    },
  });
}

/**
 * @param {'google_ads' | 'gtm'} provider
 */
function traceCreationDiagnosticsMatrix(provider) {
  const summary = getCreationDiagnosticMatrixSummary(provider);

  return stageResult('V1 test matrix', true, {
    id: 'creation_matrix',
    detail: `${summary.totalSteps} steps (${summary.requiredSteps} required) — matrix ${summary.version}`,
    data: summary,
  });
}

/**
 * @param {'google_ads' | 'gtm'} provider
 * @param {string} businessId
 */
async function traceCreationDiagnosticsConnection(provider, businessId) {
  const gate = await assertCreationDiagnosticConnection(businessId, provider);

  return stageResult('OAuth / connection gate', gate.ok, {
    id: 'creation_connection_gate',
    detail: gate.ok ? 'Connection ready for creation diagnostics.' : gate.message,
    data: {
      errorCode: gate.errorCode ?? null,
      connectionHealth: gate.connection?.connectionHealth ?? null,
      reason: gate.connection?.reason ?? null,
      scopesMissing: gate.connection?.scopesMissing ?? [],
      providerIdentifiers: gate.connection?.providerIdentifiers ?? null,
    },
    hint: gate.ok
      ? undefined
      : gate.errorCode === 'MISSING_CONNECTION'
        ? 'Connect OAuth on this businessId before running creation diagnostics.'
        : gate.errorCode === 'INSUFFICIENT_SCOPES'
          ? 'Reconnect OAuth and approve all required scopes.'
          : gate.errorCode === 'PROVISIONING_REQUIRED'
            ? 'Run smoke test or complete provisioning so provider identifiers exist.'
            : undefined,
  });
}

/**
 * @param {'google_ads' | 'gtm'} provider
 * @param {string} businessId
 * @param {string} mode
 */
async function traceCreationDiagnosticsExecution(provider, businessId, mode) {
  const runResult =
    provider === 'gtm'
      ? await runGtmCreationDiagnostics(businessId, { mode })
      : await runGoogleAdsCreationDiagnostics(businessId, { mode });

  const firstFailedStep = runResult.steps.find((step) => !step.ok && !step.skipped) ?? null;

  return stageResult('Creation diagnostic run', runResult.ok, {
    id: 'creation_diagnostic_run',
    detail: runResult.ok
      ? `Run ${runResult.diagnosticRunId} completed (${runResult.summary.passed} passed, ${runResult.summary.skipped} skipped).`
      : `${runResult.errorCode ?? firstFailedStep?.errorCode ?? 'FAILED'}: ${runResult.message}`,
    data: {
      diagnosticRunId: runResult.diagnosticRunId,
      mode: runResult.mode,
      matrixVersion: runResult.matrixVersion,
      ok: runResult.ok,
      message: runResult.message,
      errorCode: runResult.errorCode ?? null,
      summary: runResult.summary,
      steps: runResult.steps,
      firstFailedStep,
    },
    hint: firstFailedStep
      ? `First failing step: ${firstFailedStep.name} — ${firstFailedStep.message}`
      : undefined,
  });
}

/**
 * @param {string} diagnosticRunId
 */
async function traceCreationDiagnosticsArtifacts(diagnosticRunId) {
  if (!diagnosticRunId) {
    return stageResult('Persisted artifacts', false, {
      id: 'creation_artifacts',
      detail: 'No diagnosticRunId — run did not complete.',
      skipped: true,
    });
  }

  const artifacts = await listArtifactsForDiagnosticRun(diagnosticRunId);

  return stageResult('Persisted artifacts', true, {
    id: 'creation_artifacts',
    detail: `${artifacts.length} artifact(s) recorded for cleanup tracking.`,
    data: {
      artifactCount: artifacts.length,
      artifacts: artifacts.map((row) => ({
        stepId: row.stepId,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        resourceName: row.resourceName ?? null,
        resourcePath: row.resourcePath ?? null,
        externalUrl: row.externalUrl ?? null,
        cleanupStatus: row.cleanupStatus,
      })),
    },
  });
}

/**
 * Creation diagnostics never start Temporal workflows (separate from setup-runs / scrape).
 */
function traceCreationDiagnosticsTemporalBoundary() {
  return stageResult('Temporal workflow boundary', true, {
    id: 'creation_temporal_boundary',
    detail: 'Creation diagnostics do not call workflow.start (by design).',
    data: {
      startsTemporalWorkflow: false,
      apiEndpoints: [
        'POST /api/v1/dev/integrations/gtm/create-diagnostics',
        'POST /api/v1/dev/integrations/google_ads/create-diagnostics',
      ],
      cliEquivalent: 'npm run debug:dev-integrations-flow -- <businessId> --provider <gtm|google_ads> --creation-diagnostics',
    },
  });
}

/**
 * @param {{
 *   businessId: string,
 *   provider?: string,
 *   mode?: string,
 * }} options
 */
async function runCreationDiagnosticsFlowTrace(options) {
  const provider = normalizeCreationDiagnosticTraceProvider(options.provider);
  const businessId = options.businessId?.trim();
  const mode = normalizeCreationDiagnosticRunMode(
    provider,
    options.mode || getDefaultCreationDiagnosticRunMode(provider)
  );

  const stages = [];
  stages.push(traceCreationDiagnosticsEnvironment(provider));
  stages.push(traceCreationDiagnosticsMatrix(provider));

  const bcStage = await traceBusinessContext(businessId);
  stages.push(bcStage);
  if (!bcStage.ok) {
    const firstFailure = stages.find((s) => !s.ok && !s.skipped) ?? null;
    return { provider, businessId, mode, stages, firstFailure, diagnosticRunId: null, runResult: null };
  }

  const connectionStage = await traceCreationDiagnosticsConnection(provider, businessId);
  stages.push(connectionStage);

  let diagnosticRunId = null;
  let runResult = null;

  if (connectionStage.ok) {
    const runStage = await traceCreationDiagnosticsExecution(provider, businessId, mode);
    stages.push(runStage);
    diagnosticRunId = runStage.data?.diagnosticRunId ?? null;
    runResult = runStage.data ?? null;
    stages.push(await traceCreationDiagnosticsArtifacts(diagnosticRunId));
  } else {
    stages.push(
      stageResult('Creation diagnostic run', false, {
        id: 'creation_diagnostic_run',
        skipped: true,
        detail: 'Skipped because connection gate failed.',
      })
    );
    stages.push(
      stageResult('Persisted artifacts', false, {
        id: 'creation_artifacts',
        skipped: true,
        detail: 'Skipped because run did not execute.',
      })
    );
  }

  stages.push(traceCreationDiagnosticsTemporalBoundary());

  const firstFailure = stages.find((s) => !s.ok && !s.skipped) ?? null;

  return { provider, businessId, mode, stages, firstFailure, diagnosticRunId, runResult };
}

/**
 * @param {object} report
 * @returns {string}
 */
function formatCreationDiagnosticsTraceReport(report) {
  const lines = [];
  lines.push('=== Dev Integrations Creation Diagnostics Trace ===');
  lines.push(`provider: ${report.provider}`);
  lines.push(`businessId: ${report.businessId}`);
  lines.push(`mode: ${report.mode}`);
  if (report.diagnosticRunId) {
    lines.push(`diagnosticRunId: ${report.diagnosticRunId}`);
  }
  lines.push('');

  report.stages.forEach((s, i) => {
    const status = s.skipped ? 'SKIP' : s.ok ? 'OK' : 'FAIL';
    lines.push(`[${i + 1}/${report.stages.length}] ${s.label} ... ${status}`);
    if (s.detail) lines.push(`    ${s.detail}`);
    if (s.hint) lines.push(`    hint: ${s.hint}`);
  });

  const runStage = report.stages.find((s) => s.id === 'creation_diagnostic_run');
  if (runStage?.data?.steps?.length) {
    lines.push('');
    lines.push('STEP RESULTS:');
    for (const step of runStage.data.steps) {
      const status = step.skipped ? 'SKIP' : step.ok ? 'OK' : 'FAIL';
      const resource = step.resourceId ? ` resource=${step.resourceId}` : '';
      lines.push(`  - ${step.name} [${status}] ${step.message}${resource}`);
    }
  }

  lines.push('');
  if (report.firstFailure) {
    lines.push(
      `FIRST FAILURE: [${report.firstFailure.label}] — ${report.firstFailure.detail ?? 'see stage data'}`
    );
    if (report.firstFailure.hint) lines.push(`  → ${report.firstFailure.hint}`);
  } else {
    lines.push('ALL CREATION DIAGNOSTIC STAGES PASSED (or skipped where expected).');
  }

  return lines.join('\n');
}

module.exports = {
  CREATION_DIAGNOSTIC_TRACE_PROVIDERS,
  normalizeCreationDiagnosticTraceProvider,
  runCreationDiagnosticsFlowTrace,
  formatCreationDiagnosticsTraceReport,
  traceCreationDiagnosticsEnvironment,
  traceCreationDiagnosticsMatrix,
  traceCreationDiagnosticsConnection,
  traceCreationDiagnosticsExecution,
  traceCreationDiagnosticsArtifacts,
  traceCreationDiagnosticsTemporalBoundary,
};
