'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Connection, Client } = require('@temporalio/client');
const { withRetry } = require('./temporal-connect-retry');

/**
 * Starts one `SetupRunWorkflow` run (needs Temporal up + worker running elsewhere).
 */
async function main() {
  const address = process.env.TEMPORAL_ADDRESS || '127.0.0.1:7233';
  const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
  const taskQueue = process.env.TEMPORAL_TASK_QUEUE || 'setup-run';

  const connection = await withRetry('Temporal client', () =>
    Connection.connect({ address, tls: false })
  );
  const client = new Client({ connection, namespace });

  const result = await client.workflow.execute('setupRunWorkflow', {
    taskQueue,
    workflowId: `setup-run-demo-${Date.now()}`,
    args: [
      {
        setupRunId: 'demo-setup-run-from-script',
        message: 'Hello Temporal',
      },
    ],
  });

  // eslint-disable-next-line no-console
  console.warn(JSON.stringify({ ok: true, result }, null, 2));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
