'use strict';

const { Connection, Client } = require('@temporalio/client');
const { withRetry } = require('../scripts/temporal-connect-retry');
const {
  resolveTemporalAddress,
  resolveTemporalNamespace,
  resolveTemporalTaskQueue,
} = require('../constants/temporalDefaults');

/** @type {Promise<Client> | null} */
let clientPromise = null;

/**
 * Playwright E2E uses in-memory Mongo without a Temporal cluster.
 * Validates workflow start uses the configured task queue (catches API/worker drift in CI).
 */
function createE2eMockClient() {
  const expectedQueue = resolveTemporalTaskQueue();
  return {
    workflow: {
      start: async (workflowType, options) => {
        if (options?.taskQueue !== expectedQueue) {
          throw new Error(
            `Temporal task queue mismatch: expected "${expectedQueue}", got "${options?.taskQueue ?? ''}"`
          );
        }
        return undefined;
      },
    },
  };
}

/**
 * Lazily connects a Temporal client for API use (workflow starts).
 * Uses same env vars as worker/demo scripts.
 */
function getTemporalClient() {
  if (process.env.TEMPORAL_E2E_MOCK === 'true') {
    if (!clientPromise) {
      clientPromise = Promise.resolve(createE2eMockClient());
    }
    return clientPromise;
  }

  if (!clientPromise) {
    clientPromise = (async () => {
      const address = resolveTemporalAddress();
      const namespace = resolveTemporalNamespace();
      const connection = await withRetry('Temporal API client', () =>
        Connection.connect({ address, tls: false })
      );
      return new Client({ connection, namespace });
    })();
  }
  return clientPromise;
}

module.exports = { getTemporalClient };
