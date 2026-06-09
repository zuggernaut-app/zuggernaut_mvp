const express = require('express');

const router = express.Router();
const {
  SETUP_RUN_WORKFLOW_NAME,
  resolveTemporalTaskQueue,
} = require('../../constants/temporalDefaults');

router.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'zuggernaut-api',
    version: 'v1',
    orchestration: {
      taskQueue: resolveTemporalTaskQueue(),
      setupWorkflow: SETUP_RUN_WORKFLOW_NAME,
      temporalE2eMock: process.env.TEMPORAL_E2E_MOCK === 'true',
    },
  });
});

router.use('/users', require('./users'));
router.use('/auth', require('./auth'));
router.use('/onboarding', require('./onboarding'));
router.use('/business-contexts', require('./businessContexts'));
router.use('/setup-runs', require('./setupRuns'));
router.use('/integrations', require('./integrations'));
router.use('/integrations/provisioning', require('./provisioning'));
router.use('/dev/integrations', require('../../../dev-tools/backend/api/v1/devIntegrations'));

module.exports = router;
