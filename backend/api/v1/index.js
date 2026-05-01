const express = require('express');

const router = express.Router();

router.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'zuggernaut-api', version: 'v1' });
});

router.use('/users', require('./users'));
router.use('/onboarding', require('./onboarding'));
router.use('/business-contexts', require('./businessContexts'));
router.use('/setup-runs', require('./setupRuns'));

module.exports = router;
