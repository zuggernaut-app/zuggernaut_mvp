'use strict';

/** Bundler/worker entry — Temporal resolves `workflowsPath` directory via `index.js`. */
const { setupRunWorkflow } = require('./setupRun.workflow');

module.exports = {
  setupRunWorkflow,
};
