'use strict';

const express = require('express');

const router = express.Router();

router.get('/site-with-gtm', (_req, res) => {
  res
    .type('html')
    .send(
      '<html><head><script src="https://www.googletagmanager.com/gtm.js?id=GTM-MOCK"></script></head><body>Playwright E2E fixture</body></html>'
    );
});

module.exports = router;
