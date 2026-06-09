'use strict';

const {
  CREATION_DIAGNOSTIC_MATRIX_VERSION,
  CREATION_DIAGNOSTIC_PROVIDERS,
  GOOGLE_ADS_CREATION_DIAGNOSTIC_STEPS,
  GTM_CREATION_DIAGNOSTIC_STEPS,
} = require('../constants/creationDiagnostics');
const {
  isCreationDiagnosticProvider,
  getCreationDiagnosticSteps,
  getCreationDiagnosticStep,
  getCreationDiagnosticMatrixSummary,
  validateCreationDiagnosticMatrix,
} = require('../lib/dev/creationDiagnosticsMatrix');

describe('creationDiagnostics matrix (Phase 1)', () => {
  it('defines V1 providers and version', () => {
    expect(CREATION_DIAGNOSTIC_MATRIX_VERSION).toBe('v1');
    expect(CREATION_DIAGNOSTIC_PROVIDERS).toEqual(['google_ads', 'gtm']);
  });

  it('validates the full matrix with no structural errors', () => {
    expect(validateCreationDiagnosticMatrix()).toEqual({ ok: true });
  });

  describe('Google Ads V1 checklist', () => {
    const steps = GOOGLE_ADS_CREATION_DIAGNOSTIC_STEPS;

    it('has 17 executable steps covering the 13-item plan', () => {
      expect(steps).toHaveLength(17);
      expect(steps.map((s) => s.order)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
      ]);
    });

    it('includes campaign structure, keywords, extensions, audiences, and measurement', () => {
      const labels = steps.map((s) => s.label);
      expect(labels).toEqual(
        expect.arrayContaining([
          'Campaign Budget',
          'Search Campaign',
          'Location Targeting',
          'Language Targeting',
          'Ad Schedule',
          'Ad Group',
          'Responsive Search Ad',
          'Keyword (Broad Match)',
          'Keyword (Phrase Match)',
          'Keyword (Exact Match)',
          'Conversion Action',
          'Sitelink Asset',
          'Callout Asset',
          'Call Asset',
          'Remarketing / User List',
          'Negative Keyword List',
          'Offline Conversion Import (Dry Run)',
        ])
      );
    });

    it('marks optional steps that depend on config or account support', () => {
      const optional = steps.filter((s) => !s.required).map((s) => s.id);
      expect(optional).toEqual(['asset_call', 'remarketing_user_list']);
    });

    it('requires conversion action before offline import dry run', () => {
      const offline = getCreationDiagnosticStep('google_ads', 'offline_conversion_import_dry_run');
      expect(offline.prerequisites).toContain('conversion_action');
    });
  });

  describe('GTM V1 checklist', () => {
    const steps = GTM_CREATION_DIAGNOSTIC_STEPS;

    it('has 10 executable steps in plan order', () => {
      expect(steps).toHaveLength(10);
      expect(steps.map((s) => s.id)).toEqual([
        'container',
        'workspace',
        'builtin_variables',
        'data_layer_variable',
        'page_view_trigger',
        'custom_event_trigger',
        'ga4_config_tag',
        'google_ads_conversion_tag',
        'container_version',
        'publish_version',
      ]);
    });

    it('does not publish by default (publish is optional)', () => {
      const publish = getCreationDiagnosticStep('gtm', 'publish_version');
      expect(publish.required).toBe(false);
      expect(publish.skipWhen).toMatch(/create_and_publish/i);
    });

    it('skips GA4 and Ads conversion tags when config is missing', () => {
      expect(getCreationDiagnosticStep('gtm', 'ga4_config_tag').skipWhen).toMatch(/measurement ID/i);
      expect(getCreationDiagnosticStep('gtm', 'google_ads_conversion_tag').skipWhen).toMatch(
        /conversion ID/i
      );
    });
  });

  describe('matrix accessors', () => {
    it('returns steps for supported providers only', () => {
      expect(getCreationDiagnosticSteps('google_ads')).toBe(GOOGLE_ADS_CREATION_DIAGNOSTIC_STEPS);
      expect(getCreationDiagnosticSteps('gtm')).toBe(GTM_CREATION_DIAGNOSTIC_STEPS);
      expect(() => getCreationDiagnosticSteps('gbp')).toThrow(/Unsupported creation diagnostic provider/);
    });

    it('exposes summary for UI and trace consumers', () => {
      const summary = getCreationDiagnosticMatrixSummary('gtm');
      expect(summary.version).toBe('v1');
      expect(summary.provider).toBe('gtm');
      expect(summary.totalSteps).toBe(10);
      expect(summary.requiredSteps).toBe(7);
      expect(summary.steps[0]).toEqual(
        expect.objectContaining({ id: 'container', label: 'Container', order: 1 })
      );
    });

    it('identifies creation diagnostic providers', () => {
      expect(isCreationDiagnosticProvider('google_ads')).toBe(true);
      expect(isCreationDiagnosticProvider('gtm')).toBe(true);
      expect(isCreationDiagnosticProvider('gbp')).toBe(false);
    });
  });

  it('freezes step definitions so the matrix cannot be mutated at runtime', () => {
    expect(Object.isFrozen(GOOGLE_ADS_CREATION_DIAGNOSTIC_STEPS)).toBe(true);
    expect(Object.isFrozen(GTM_CREATION_DIAGNOSTIC_STEPS)).toBe(true);
    expect(Object.isFrozen(GOOGLE_ADS_CREATION_DIAGNOSTIC_STEPS[0])).toBe(true);
    expect(() => {
      GOOGLE_ADS_CREATION_DIAGNOSTIC_STEPS[0].order = 99;
    }).toThrow();
  });
});
