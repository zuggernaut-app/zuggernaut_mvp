'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Connection, Client } = require('@temporalio/client');
const { withRetry } = require('./temporal-connect-retry');
const {
  SETUP_RUN_WORKFLOW_NAME,
  resolveTemporalAddress,
  resolveTemporalNamespace,
  resolveTemporalTaskQueue,
} = require('../constants/temporalDefaults');

/**
 * Starts one `SetupRunWorkflow` run (needs Temporal up + worker running elsewhere).
 */
async function main() {
  const address = resolveTemporalAddress();
  const namespace = resolveTemporalNamespace();
  const taskQueue = resolveTemporalTaskQueue();

  const connection = await withRetry('Temporal client', () =>
    Connection.connect({ address, tls: false })
  );
  const client = new Client({ connection, namespace });

  const result = await client.workflow.execute(SETUP_RUN_WORKFLOW_NAME, {
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
