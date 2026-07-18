'use strict';

/**
 * Dev-only integration diagnostics — must never be enabled in production.
 * Gate lives in backend so production routing does not depend on dev-tools modules.
 */
function isIntegrationDiagnosticsEnabled() {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  const flag = process.env.ENABLE_INTEGRATION_DIAGNOSTICS?.trim().toLowerCase();
  return flag === 'true' || flag === '1';
}

module.exports = { isIntegrationDiagnosticsEnabled };
