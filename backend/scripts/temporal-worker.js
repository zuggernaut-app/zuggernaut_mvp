'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Worker, NativeConnection } = require('@temporalio/worker');
const { withRetry } = require('./temporal-connect-retry');

async function main() {
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
