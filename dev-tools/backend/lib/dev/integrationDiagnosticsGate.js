'use strict';

/** Re-export production gate so dev-tools and backend share one source of truth. */
module.exports = require('../../../../backend/lib/integrationDiagnosticsGate');
