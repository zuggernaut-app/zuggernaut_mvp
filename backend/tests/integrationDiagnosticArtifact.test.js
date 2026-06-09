'use strict';

const mongoose = require('mongoose');
require('../models');
const { createBareUser } = require('./helpers');
const { ensureSandboxBusiness } = require('../services/dev/integrationDiagnosticsService');
const {
  createDiagnosticRunId,
  recordIntegrationDiagnosticArtifact,
  listArtifactsForDiagnosticRun,
  listArtifactsForBusiness,
} = require('../services/dev/integrationDiagnosticArtifactService');
const { getCreationDiagnosticStep } = require('../lib/dev/creationDiagnosticsMatrix');

const IntegrationDiagnosticArtifact = mongoose.model('IntegrationDiagnosticArtifact');

describe('IntegrationDiagnosticArtifact (Phase 3)', () => {
  it('registers the model with required tenant and run fields', () => {
    const schema = IntegrationDiagnosticArtifact.schema;
    expect(schema.path('businessId').isRequired).toBe(true);
    expect(schema.path('provider').isRequired).toBe(true);
    expect(schema.path('resourceType').isRequired).toBe(true);
    expect(schema.path('resourceId').isRequired).toBe(true);
    expect(schema.path('diagnosticRunId').isRequired).toBe(true);
    expect(schema.path('stepId').isRequired).toBe(true);
    expect(schema.path('action').isRequired).toBe(true);
    expect(schema.path('mode').isRequired).toBe(true);
    expect(schema.path('cleanupStatus').options.default).toBe('pending');
  });

  it('creates diagnostic run ids', () => {
    const id = createDiagnosticRunId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it('persists and lists artifacts for a diagnostic run', async () => {
    const user = await createBareUser('diag-artifact@test.com');
    const sandbox = await ensureSandboxBusiness(user._id);
    const diagnosticRunId = createDiagnosticRunId();
    const step = getCreationDiagnosticStep('google_ads', 'campaign_budget');

    const artifact = await recordIntegrationDiagnosticArtifact(sandbox.businessId, {
      provider: 'google_ads',
      diagnosticRunId,
      stepId: step.id,
      action: step.action,
      mode: 'create_paused',
      resourceType: step.resourceType,
      resourceId: 'customers/123/campaignBudgets/456',
      resourceName: 'ZUG_DEV_TEST_campaign_budget',
      resourcePath: 'customers/123/campaignBudgets/456',
      externalUrl: 'https://ads.google.com/',
      metadata: { deliveryMethod: 'STANDARD' },
    });

    expect(artifact.businessId.toString()).toBe(sandbox.businessId.toString());
    expect(artifact.diagnosticRunId).toBe(diagnosticRunId);
    expect(artifact.cleanupStatus).toBe('pending');

    const forRun = await listArtifactsForDiagnosticRun(diagnosticRunId);
    expect(forRun).toHaveLength(1);
    expect(forRun[0].resourceId).toBe('customers/123/campaignBudgets/456');

    const forBusiness = await listArtifactsForBusiness(sandbox.businessId, {
      provider: 'google_ads',
    });
    expect(forBusiness.some((row) => row.diagnosticRunId === diagnosticRunId)).toBe(true);
  });

  it('defines a unique compound index on diagnosticRunId + stepId + resourceId', () => {
    const indexes = IntegrationDiagnosticArtifact.schema.indexes();
    const compound = indexes.find(
      ([fields]) =>
        fields.diagnosticRunId === 1 && fields.stepId === 1 && fields.resourceId === 1
    );
    expect(compound).toBeTruthy();
    expect(compound[1]?.unique).toBe(true);
  });

  it('enforces unique artifact per run step and resource id', async () => {
    await IntegrationDiagnosticArtifact.syncIndexes();

    const user = await createBareUser('diag-artifact-dup@test.com');
    const sandbox = await ensureSandboxBusiness(user._id);
    const diagnosticRunId = createDiagnosticRunId();
    const step = getCreationDiagnosticStep('gtm', 'workspace');

    const payload = {
      provider: 'gtm',
      diagnosticRunId,
      stepId: step.id,
      action: step.action,
      mode: 'create_paused',
      resourceType: step.resourceType,
      resourceId: '2',
    };

    await recordIntegrationDiagnosticArtifact(sandbox.businessId, payload);

    await expect(recordIntegrationDiagnosticArtifact(sandbox.businessId, payload)).rejects.toThrow(
      /duplicate key/i
    );
  });

  it('rejects google_ads create_and_publish mode at persistence time', async () => {
    const user = await createBareUser('diag-artifact-mode@test.com');
    const sandbox = await ensureSandboxBusiness(user._id);
    const step = getCreationDiagnosticStep('google_ads', 'campaign_budget');

    await expect(
      recordIntegrationDiagnosticArtifact(sandbox.businessId, {
        provider: 'google_ads',
        diagnosticRunId: createDiagnosticRunId(),
        stepId: step.id,
        action: step.action,
        mode: 'create_and_publish',
        resourceType: step.resourceType,
        resourceId: 'budget-1',
      })
    ).rejects.toThrow(/only supported for GTM/);
  });
});
