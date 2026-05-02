'use strict';

const { completeSkeletonSetupActivity } = require('./completeSkeletonSetup');

/** Activity name → implementation (see `Worker.create` in `scripts/temporal-worker.js`). */
module.exports = {
  completeSkeletonSetupActivity,
};
