'use strict';

/** Bundler/worker entry — Temporal resolves `workflowsPath` directory via `index.js`. */
const { setupRunWorkflow } = require('./setupRun.workflow');
const { scrapeWorkflow } = require('./scrape.workflow');
const { gracePauseWorkflow } = require('./gracePause.workflow');
const { disapprovalPollWorkflow } = require('./disapprovalPoll.workflow');

module.exports = {
  setupRunWorkflow,
  scrapeWorkflow,
  gracePauseWorkflow,
  disapprovalPollWorkflow,
};
