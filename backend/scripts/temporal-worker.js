'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');

require('../models');

const { initOtel } = require('../lib/observability/otel');
initOtel('zuggernaut-worker');

const { assertWorkerEnvironment } = require('../lib/auth/assertAuthEnvironment');
const { SETUP_RUN_WORKFLOW_ACTIVITIES } = require('../constants/setupWorkflow');
const { Worker, NativeConnection } = require('@temporalio/worker');
const { withRetry } = require('./temporal-connect-retry');
const { resolveTemporalConnectOptions } = require('../lib/temporalConnectionOptions');
const {
  resolveTemporalNamespace,
  resolveTemporalTaskQueue,
} = require('../constants/temporalDefaults');

assertWorkerEnvironment();

function redactMongoUri(uri) {
  return typeof uri === 'string' ? uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@') : '';
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/zuggernaut_test';
  await mongoose.connect(mongoUri);

  // eslint-disable-next-line no-console
  console.warn(
    JSON.stringify({
      msg: 'Temporal worker MongoDB connected',
      mongodbUri: redactMongoUri(mongoUri),
    })
  );

  const namespace = resolveTemporalNamespace();
  const taskQueue = resolveTemporalTaskQueue();
  const connectOptions = resolveTemporalConnectOptions();

  const connection = await withRetry('Temporal worker', () =>
    NativeConnection.connect(connectOptions)
  );

  const workflowsPath = path.resolve(path.join(__dirname, '..', 'workflows'));

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath,
    activities: require('../activities'),
    bundlerOptions: {
      webpackConfigHook: (config) => {
        config.cache = false;
        return config;
      },
    },
  });

  // eslint-disable-next-line no-console
  console.warn(
    JSON.stringify({
      msg: 'Temporal worker ready — polling for tasks',
      status: 'listening',
      address: connectOptions.address,
      namespace,
      taskQueue,
      registeredActivities: SETUP_RUN_WORKFLOW_ACTIVITIES.length,
      activityNames: SETUP_RUN_WORKFLOW_ACTIVITIES,
      workflowsPath,
      rules: [
        'Run exactly one worker process per TEMPORAL_TASK_QUEUE',
        'Use the same MONGODB_URI and TEMPORAL_* values as the API',
        'If setup runs stay RUNNING, verify this process is alive and task queue matches',
      ],
    })
  );

  await worker.run();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
