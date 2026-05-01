'use strict';

const { completeSkeletonSetupActivity } = require('./completeSkeletonSetup');

/** Activity name → implementation (see `Worker.create` in `scripts/temporal-worker.js`). */
module.exports = {
  completeSkeletonSetupActivity,
  /** Workflow schedules this name (stable in history/replay); same impl as completeSkeletonSetupActivity. */
  helloActivity: completeSkeletonSetupActivity,
};
