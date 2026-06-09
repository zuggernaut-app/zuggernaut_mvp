'use strict';

/**
 * Dev-only integration diagnostics — must never be enabled in production.
 */
function isIntegrationDiagnosticsEnabled() {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  const flag = process.env.ENABLE_INTEGRATION_DIAGNOSTICS?.trim().toLowerCase();
  return flag === 'true' || flag === '1';
}

module.exports = { isIntegrationDiagnosticsEnabled };
