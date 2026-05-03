'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');

require('../models');

const { Worker, NativeConnection } = require('@temporalio/worker');
const { withRetry } = require('./temporal-connect-retry');

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

  const address = process.env.TEMPORAL_ADDRESS || '127.0.0.1:7233';
  const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE || 'setup-run';

  const connection = await withRetry('Temporal worker', () =>
    NativeConnection.connect({
      address,
      tls: false,
    })
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
      msg: 'Temporal worker listening',
      address,
      namespace,
      taskQueue,
      workflowsPath,
      hint: 'Use the same MONGODB_URI as the API. Run only one worker on this task queue.',
    })
  );

  await worker.run();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
