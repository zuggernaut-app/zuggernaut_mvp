'use strict';

const { buildSupportPlaybook } = require('../lib/setupSupportPlaybook');

describe('setupSupportPlaybook', () => {
  it('returns GTM snippet steps with deep links for GTM_SNIPPET_PENDING', () => {
    const playbook = buildSupportPlaybook({
      errorCode: 'GTM_SNIPPET_PENDING',
      setupRunId: '507f1f77bcf86cd799439011',
      publicContainerId: 'GTM-TEST',
    });

    expect(playbook?.title).toMatch(/Google Tag Manager snippet/i);
    expect(playbook?.steps.some((s) => s.href === 'https://tagmanager.google.com/')).toBe(true);
    expect(playbook?.steps.some((s) => s.href === '/setup')).toBe(true);
  });

  it('returns business edit link for conversion goals error', () => {
    const playbook = buildSupportPlaybook({
      errorCode: 'CONVERSION_STRATEGY_MISSING_GOALS',
      businessId: '507f1f77bcf86cd799439012',
    });

    expect(playbook?.steps.some((s) => s.href === '/business-context/507f1f77bcf86cd799439012/edit')).toBe(
      true
    );
  });

  it('returns advanced steps for in_progress outcome', () => {
    const playbook = buildSupportPlaybook({
      outcomeKind: 'in_progress',
      setupRunId: '507f1f77bcf86cd799439011',
    });

    expect(playbook?.advancedSteps?.length).toBeGreaterThan(0);
  });
});
