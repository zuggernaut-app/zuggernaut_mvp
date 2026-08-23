const express = require('express');

const router = express.Router();
const {
  SETUP_RUN_WORKFLOW_NAME,
  resolveTemporalTaskQueue,
} = require('../../constants/temporalDefaults');
const { isIntegrationDiagnosticsEnabled } = require('../../lib/integrationDiagnosticsGate');

/** @type {import('express').Router | null} */
let devIntegrationsRouter = null;

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'zuggernaut-api',
    version: 'v1',
    orchestration: {
      taskQueue: resolveTemporalTaskQueue(),
      setupWorkflow: SETUP_RUN_WORKFLOW_NAME,
      temporalE2eMock: process.env.TEMPORAL_E2E_MOCK === 'true',
      temporalE2eEmbeddedWorker: process.env.TEMPORAL_E2E_EMBEDDED_WORKER === 'true',
    },
  });
});

if (process.env.E2E_FIXTURE_ROUTES === 'true') {
  router.use('/e2e/fixtures', require('./e2eFixtures'));
}

router.use('/users', require('./users'));
router.use('/auth', require('./auth'));
router.use('/onboarding', require('./onboarding'));
router.use('/business-contexts', require('./businessContexts'));
router.use('/setup-runs', require('./setupRuns'));
router.use('/integrations', require('./integrations'));
router.use('/integrations/provisioning', require('./provisioning'));
router.use('/billing', require('./billing'));
router.use('/settings', require('./settings'));
router.use('/orgs', require('./orgs'));
router.use('/admin', require('./admin'));

router.use('/dev/integrations', (req, res, next) => {
  if (!isIntegrationDiagnosticsEnabled()) {
    return res.status(404).json({
      error: 'not_found',
      message: 'Not found',
    });
  }

  if (!devIntegrationsRouter) {
    // Lazy-load dev-tools routes only when diagnostics are enabled (never in production).
    require('../../models/devDiagnosticModels');
    devIntegrationsRouter = require('../../../dev-tools/backend/api/v1/devIntegrations');
  }

  return devIntegrationsRouter(req, res, next);
});

module.exports = router;
