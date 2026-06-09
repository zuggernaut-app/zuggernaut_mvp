'use strict';

const { isIntegrationDiagnosticsEnabled } = require('../../../lib/dev/integrationDiagnosticsGate');

/**
 * Returns 404 when integration diagnostics are disabled (production or flag off).
 */
function requireIntegrationDiagnostics(_req, res, next) {
  if (!isIntegrationDiagnosticsEnabled()) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Not found',
    });
  }
  next();
}

module.exports = { requireIntegrationDiagnostics };
