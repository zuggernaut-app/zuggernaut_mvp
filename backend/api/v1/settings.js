'use strict';

const express = require('express');
const { isSoftLaunchMode } = require('../../constants/softLaunch');

const router = express.Router();

router.get('/soft-launch', (_req, res) => {
  res.json({ softLaunchMode: isSoftLaunchMode() });
});

module.exports = router;
