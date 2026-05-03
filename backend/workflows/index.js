'use strict';

/** Bundler/worker entry — Temporal resolves `workflowsPath` directory via `index.js`. */
const { setupRunWorkflow } = require('./setupRun.workflow');
const { scrapeWorkflow } = require('./scrape.workflow');

module.exports = {
  setupRunWorkflow,
  scrapeWorkflow,
};
