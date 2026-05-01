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
  const mongoUri = process.env.MONGODB_URI || 'mongodb+srv://zuggernaut_user:5AuABrBza9GiBg@zuggernautdevcluster.bpo3khu.mongodb.net/?appName=ZuggernautDevCluste';
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
      // Plaintext gRPC to local docker-compose frontend (avoids any implicit TLS path).
      tls: false,
    })
  );

  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowsPath: path.join(__dirname, '..', 'workflows'),
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
    })
  );

  await worker.run();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
