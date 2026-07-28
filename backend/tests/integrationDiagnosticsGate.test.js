'use strict';

const { isIntegrationDiagnosticsEnabled } = require('../lib/integrationDiagnosticsGate');

describe('integrationDiagnosticsGate', () => {
  const prev = { ...process.env };

  afterEach(() => {
    process.env = { ...prev };
  });

  it('is disabled in production even when ENABLE_INTEGRATION_DIAGNOSTICS=true', () => {
    process.env.NODE_ENV = 'production';
    process.env.ENABLE_INTEGRATION_DIAGNOSTICS = 'true';
    expect(isIntegrationDiagnosticsEnabled()).toBe(false);
  });

  it('can be enabled outside production', () => {
    process.env.NODE_ENV = 'development';
    process.env.ENABLE_INTEGRATION_DIAGNOSTICS = 'true';
    expect(isIntegrationDiagnosticsEnabled()).toBe(true);
  });
});
