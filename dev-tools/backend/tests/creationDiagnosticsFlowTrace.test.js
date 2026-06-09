'use strict';

const { mongoose } = require('../shared');
require('../shared');
const { createBareUser } = require('../../../backend/tests/helpers');
const { encryptToken } = require('../../../backend/lib/crypto/tokenEncryption');
const { completeGoogleOAuthCallback } = require('../../../backend/services/integrations/googleOAuthService');
const { ensureSandboxBusiness } = require('../services/dev/integrationDiagnosticsService');
const {
  runCreationDiagnosticsFlowTrace,
  formatCreationDiagnosticsTraceReport,
  normalizeCreationDiagnosticTraceProvider,
  traceCreationDiagnosticsTemporalBoundary,
} = require('../lib/dev/creationDiagnosticsFlowTrace');

const IntegrationConnection = mongoose.model('IntegrationConnection');

const GTM_SCOPES = [
  'https://www.googleapis.com/auth/tagmanager.edit.containers',
  'https://www.googleapis.com/auth/tagmanager.publish',
  'https://www.googleapis.com/auth/tagmanager.manage.accounts',
];

describe('creationDiagnosticsFlowTrace (Phase 8)', () => {
  beforeEach(() => {
    process.env.GTM_API_MOCK = 'true';
    process.env.GOOGLE_ADS_API_MOCK = 'true';
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
  });

  it('only supports google_ads and gtm', () => {
    expect(normalizeCreationDiagnosticTraceProvider('gtm')).toBe('gtm');
    expect(() => normalizeCreationDiagnosticTraceProvider('gbp')).toThrow(/not gbp/i);
  });

  it('documents that creation diagnostics do not start Temporal', () => {
    const stage = traceCreationDiagnosticsTemporalBoundary();
    expect(stage.ok).toBe(true);
    expect(stage.data.startsTemporalWorkflow).toBe(false);
  });

  it('reports connection gate failure when provider is not connected', async () => {
    const user = await createBareUser('trace-create-missing@test.com');
    const sandbox = await ensureSandboxBusiness(user._id);

    const report = await runCreationDiagnosticsFlowTrace({
      businessId: sandbox.businessId,
      provider: 'gtm',
      mode: 'create_paused',
    });

    const byId = Object.fromEntries(report.stages.map((s) => [s.id, s]));
    expect(byId.creation_connection_gate.ok).toBe(false);
    expect(byId.creation_connection_gate.data.errorCode).toBe('MISSING_CONNECTION');
    expect(byId.creation_diagnostic_run.skipped).toBe(true);
    expect(report.firstFailure?.id).toBe('creation_connection_gate');
    expect(formatCreationDiagnosticsTraceReport(report)).toContain('Creation Diagnostics Trace');
  });

  it('runs full GTM creation diagnostics trace after mock OAuth', async () => {
    const user = await createBareUser('trace-create-gtm@test.com');
    const sandbox = await ensureSandboxBusiness(user._id);

    await completeGoogleOAuthCallback({
      businessId: sandbox.businessId,
      provider: 'gtm',
      userId: user._id.toString(),
      code: 'mock-auth-code',
    });

    await IntegrationConnection.findOneAndUpdate(
      { businessId: sandbox.businessId, provider: 'gtm' },
      {
        $set: {
          providerIdentifiers: {
            accountId: '6357971694',
            containerId: '253902272',
            workspaceId: '2',
            publicContainerId: 'GTM-TRACE',
          },
        },
      }
    );

    const report = await runCreationDiagnosticsFlowTrace({
      businessId: sandbox.businessId,
      provider: 'gtm',
      mode: 'create_paused',
    });

    const byId = Object.fromEntries(report.stages.map((s) => [s.id, s]));
    expect(byId.creation_matrix.ok).toBe(true);
    expect(byId.creation_connection_gate.ok).toBe(true);
    expect(byId.creation_diagnostic_run.ok).toBe(true);
    expect(byId.creation_artifacts.data.artifactCount).toBeGreaterThan(0);
    expect(byId.creation_temporal_boundary.ok).toBe(true);
    expect(report.diagnosticRunId).toBeTruthy();
    expect(report.firstFailure).toBeNull();

    const publishStep = byId.creation_diagnostic_run.data.steps.find((s) => s.name === 'publish_version');
    expect(publishStep.skipped).toBe(true);
  });

  it('runs Google Ads creation diagnostics in validate_only without creating resources', async () => {
    const user = await createBareUser('trace-create-ads@test.com');
    const sandbox = await ensureSandboxBusiness(user._id);

    await IntegrationConnection.create({
      businessId: sandbox.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      scopes: ['https://www.googleapis.com/auth/adwords'],
      accessTokenEnc: encryptToken('mock-access-token'),
      refreshTokenEnc: encryptToken('mock-refresh-token'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      providerIdentifiers: { customerId: '1234567890' },
    });

    const report = await runCreationDiagnosticsFlowTrace({
      businessId: sandbox.businessId,
      provider: 'google_ads',
      mode: 'validate_only',
    });

    expect(report.runResult.summary.skipped).toBeGreaterThan(0);
    expect(report.runResult.summary.passed).toBe(0);
    expect(report.runResult.ok).toBe(true);
    expect(report.runResult.steps.every((step) => step.skipped)).toBe(true);
  });

  it('reports INSUFFICIENT_SCOPES at connection gate', async () => {
    const user = await createBareUser('trace-create-scopes@test.com');
    const sandbox = await ensureSandboxBusiness(user._id);

    await IntegrationConnection.create({
      businessId: sandbox.businessId,
      provider: 'gtm',
      connectionHealth: 'connected',
      scopes: ['https://www.googleapis.com/auth/tagmanager.manage.accounts'],
      accessTokenEnc: encryptToken('mock-access-token'),
      refreshTokenEnc: encryptToken('mock-refresh-token'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      providerIdentifiers: {
        accountId: '1',
        containerId: '2',
        workspaceId: '3',
      },
    });

    const report = await runCreationDiagnosticsFlowTrace({
      businessId: sandbox.businessId,
      provider: 'gtm',
    });

    const gate = report.stages.find((s) => s.id === 'creation_connection_gate');
    expect(gate.ok).toBe(false);
    expect(gate.data.errorCode).toBe('INSUFFICIENT_SCOPES');
    expect(gate.data.scopesMissing.length).toBeGreaterThan(0);
  });
});
