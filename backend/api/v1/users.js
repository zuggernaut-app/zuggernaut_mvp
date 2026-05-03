'use strict';

const express = require('express');

/** Password-based onboarding uses `POST /api/v1/auth/register`. */
const router = express.Router();

router.post('/', (_req, res) =>
  res.status(410).json({
    error: 'gone',
    message: 'User creation moved to POST /api/v1/auth/register (includes password authentication).',
  }),
);

module.exports = router;
