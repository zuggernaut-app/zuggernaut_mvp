'use strict';

/**
 * Shared Temporal connection defaults for API, worker, and demo scripts.
 * Override via TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE, TEMPORAL_TASK_QUEUE in backend/.env.
 */
const TEMPORAL_DEFAULT_ADDRESS = '127.0.0.1:7233';
const TEMPORAL_DEFAULT_NAMESPACE = 'default';
const TEMPORAL_DEFAULT_TASK_QUEUE = 'setup-run';

const SETUP_RUN_WORKFLOW_NAME = 'setupRunWorkflow';
const SCRAPE_WORKFLOW_NAME = 'scrapeWorkflow';

function resolveTemporalAddress() {
  return process.env.TEMPORAL_ADDRESS?.trim() || TEMPORAL_DEFAULT_ADDRESS;
}

function resolveTemporalNamespace() {
  return process.env.TEMPORAL_NAMESPACE?.trim() || TEMPORAL_DEFAULT_NAMESPACE;
}

function resolveTemporalTaskQueue() {
  return process.env.TEMPORAL_TASK_QUEUE?.trim() || TEMPORAL_DEFAULT_TASK_QUEUE;
}

module.exports = {
  TEMPORAL_DEFAULT_ADDRESS,
  TEMPORAL_DEFAULT_NAMESPACE,
  TEMPORAL_DEFAULT_TASK_QUEUE,
  SETUP_RUN_WORKFLOW_NAME,
  SCRAPE_WORKFLOW_NAME,
  resolveTemporalAddress,
  resolveTemporalNamespace,
  resolveTemporalTaskQueue,
};
