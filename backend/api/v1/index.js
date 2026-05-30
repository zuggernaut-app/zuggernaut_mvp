const express = require('express');

const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'zuggernaut-api', version: 'v1' });
});

router.use('/users', require('./users'));
router.use('/auth', require('./auth'));
router.use('/onboarding', require('./onboarding'));
router.use('/business-contexts', require('./businessContexts'));
router.use('/setup-runs', require('./setupRuns'));
router.use('/integrations', require('./integrations'));
router.use('/integrations/provisioning', require('./provisioning'));

module.exports = router;
