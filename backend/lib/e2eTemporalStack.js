'use strict';

const path = require('path');
const { TestWorkflowEnvironment } = require('@temporalio/testing');
const { Worker } = require('@temporalio/worker');
const { resolveTemporalTaskQueue } = require('../constants/temporalDefaults');

/** @type {import('@temporalio/testing').TestWorkflowEnvironment | null} */
let testEnv = null;
/** @type {import('@temporalio/worker').Worker | null} */
let worker = null;
/** @type {Promise<void> | null} */
let workerRunPromise = null;
/** @type {Promise<import('@temporalio/client').Client> | null} */
let clientPromise = null;

/**
 * Embedded Temporal test server + worker for Playwright E2E.
 * Uses real workflow/activity code with mocked Google APIs (see start-e2e-api.js).
 */
async function startE2eTemporalStack() {
  if (clientPromise) {
    return clientPromise;
  }

  clientPromise = (async () => {
    require('../models');

    testEnv = await TestWorkflowEnvironment.createLocal();
    const taskQueue = resolveTemporalTaskQueue();

    worker = await Worker.create({
      connection: testEnv.nativeConnection,
      taskQueue,
      workflowsPath: path.resolve(__dirname, '..', 'workflows'),
      activities: require('../activities'),
      bundlerOptions: {
        webpackConfigHook: (config) => {
          config.cache = false;
          return config;
        },
      },
    });

    workerRunPromise = worker.run();

    return testEnv.client;
  })();

  return clientPromise;
}

async function getE2eTemporalClient() {
  return startE2eTemporalStack();
}

async function stopE2eTemporalStack() {
  if (worker) {
    worker.shutdown();
    await workerRunPromise?.catch(() => undefined);
    worker = null;
    workerRunPromise = null;
  }
  if (testEnv) {
    await testEnv.teardown();
    testEnv = null;
  }
  clientPromise = null;
}

module.exports = {
  startE2eTemporalStack,
  getE2eTemporalClient,
  stopE2eTemporalStack,
};
