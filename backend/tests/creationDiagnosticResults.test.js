'use strict';

const { CREATION_DIAGNOSTIC_RUN_MODES } = require('../constants/enums');
const { getCreationDiagnosticStep } = require('../lib/dev/creationDiagnosticsMatrix');
const {
  normalizeCreationDiagnosticRunMode,
  getDefaultCreationDiagnosticRunMode,
  shouldSkipStepForRunMode,
  buildSkippedCreationDiagnosticStepResult,
  buildCreationDiagnosticStepResult,
  validateCreationDiagnosticStepResult,
  summarizeCreationDiagnosticSteps,
  buildCreationDiagnosticRunResult,
  buildDiagnosticResourceLabel,
  CREATION_DIAGNOSTIC_SAFETY,
} = require('../lib/dev/creationDiagnosticResults');

describe('creationDiagnosticResults (Phase 2)', () => {
  const budgetStep = getCreationDiagnosticStep('google_ads', 'campaign_budget');
  const publishStep = getCreationDiagnosticStep('gtm', 'publish_version');

  it('defines safety constants and run modes', () => {
    expect(CREATION_DIAGNOSTIC_SAFETY.RESOURCE_NAME_PREFIX).toBe('ZUG_DEV_TEST_');
    expect(CREATION_DIAGNOSTIC_SAFETY.CONFIRM_CREATE_EXTERNAL_RESOURCES_FIELD).toBe(
      'confirmCreateExternalResources'
    );
    expect(CREATION_DIAGNOSTIC_RUN_MODES).toEqual([
      'validate_only',
      'create_paused',
      'create_and_publish',
    ]);
  });

  it('defaults google_ads and gtm to create_paused', () => {
    expect(getDefaultCreationDiagnosticRunMode('google_ads')).toBe('create_paused');
    expect(getDefaultCreationDiagnosticRunMode('gtm')).toBe('create_paused');
    expect(normalizeCreationDiagnosticRunMode('google_ads')).toBe('create_paused');
  });

  it('rejects create_and_publish for google_ads', () => {
    expect(() => normalizeCreationDiagnosticRunMode('google_ads', 'create_and_publish')).toThrow(
      /only supported for GTM/
    );
  });

  it('allows create_and_publish for gtm', () => {
    expect(normalizeCreationDiagnosticRunMode('gtm', 'create_and_publish')).toBe('create_and_publish');
  });

  it('skips all steps in validate_only mode', () => {
    expect(shouldSkipStepForRunMode('validate_only', budgetStep)).toBe(true);
    expect(shouldSkipStepForRunMode('validate_only', publishStep)).toBe(true);
  });

  it('skips GTM publish unless create_and_publish is selected', () => {
    expect(shouldSkipStepForRunMode('create_paused', publishStep)).toBe(true);
    expect(shouldSkipStepForRunMode('create_and_publish', publishStep)).toBe(false);
    expect(shouldSkipStepForRunMode('create_paused', budgetStep)).toBe(false);
  });

  it('builds the shared step result shape', () => {
    const result = buildCreationDiagnosticStepResult({
      matrixStep: budgetStep,
      ok: true,
      skipped: false,
      message: 'Campaign budget created.',
      resourceId: 'customers/123/campaignBudgets/456',
      resourceName: 'ZUG_DEV_TEST_campaign_budget',
      details: { deliveryMethod: 'STANDARD' },
    });

    expect(result).toEqual({
      name: 'campaign_budget',
      provider: 'google_ads',
      action: 'create_campaign_budget',
      ok: true,
      skipped: false,
      resourceType: 'ads_campaign_budget',
      resourceId: 'customers/123/campaignBudgets/456',
      resourceName: 'ZUG_DEV_TEST_campaign_budget',
      message: 'Campaign budget created.',
      details: { deliveryMethod: 'STANDARD' },
    });
    expect(validateCreationDiagnosticStepResult(result)).toBe(result);
  });

  it('requires errorCode on failed non-skipped steps', () => {
    expect(() =>
      buildCreationDiagnosticStepResult({
        matrixStep: budgetStep,
        ok: false,
        skipped: false,
        message: 'Mutate failed.',
      })
    ).toThrow(/errorCode/);

    const failed = buildCreationDiagnosticStepResult({
      matrixStep: budgetStep,
      ok: false,
      skipped: false,
      message: 'Mutate failed.',
      errorCode: 'GOOGLE_ADS_MUTATE_FAILED',
    });
    expect(failed.errorCode).toBe('GOOGLE_ADS_MUTATE_FAILED');
  });

  it('builds skipped step results with ok=true', () => {
    const skipped = buildSkippedCreationDiagnosticStepResult(publishStep, {
      mode: 'create_paused',
    });

    expect(skipped).toMatchObject({
      name: 'publish_version',
      ok: true,
      skipped: true,
      provider: 'gtm',
    });
    expect(skipped.message).toMatch(/create_and_publish/i);
  });

  it('summarizes and aggregates run results', () => {
    const passed = buildCreationDiagnosticStepResult({
      matrixStep: budgetStep,
      ok: true,
      message: 'ok',
    });
    const skipped = buildSkippedCreationDiagnosticStepResult(publishStep, { mode: 'create_paused' });
    const failed = buildCreationDiagnosticStepResult({
      matrixStep: getCreationDiagnosticStep('google_ads', 'search_campaign'),
      ok: false,
      skipped: false,
      message: 'failed',
      errorCode: 'GOOGLE_ADS_MUTATE_FAILED',
    });

    const steps = [passed, skipped, failed];
    expect(summarizeCreationDiagnosticSteps(steps)).toEqual({
      total: 3,
      passed: 1,
      failed: 1,
      skipped: 1,
    });

    const run = buildCreationDiagnosticRunResult({
      diagnosticRunId: 'run-1',
      provider: 'google_ads',
      mode: 'create_paused',
      businessId: 'biz-1',
      startedAt: '2026-06-07T00:00:00.000Z',
      completedAt: '2026-06-07T00:00:05.000Z',
      steps,
    });

    expect(run.ok).toBe(false);
    expect(run.errorCode).toBe('GOOGLE_ADS_MUTATE_FAILED');
    expect(run.matrixVersion).toBe('v1');
    expect(run.summary.failed).toBe(1);
  });

  it('builds prefixed diagnostic resource labels', () => {
    const label = buildDiagnosticResourceLabel({
      businessId: '6a254002800c3f3bab010638',
      stepId: 'campaign_budget',
      suffix: 'test',
    });

    expect(label).toBe('ZUG_DEV_TEST_campaign_budget_ab010638_test');
  });
});
