'use strict';

const { Connection, Client } = require('@temporalio/client');
const { withRetry } = require('../scripts/temporal-connect-retry');

/** @type {Promise<Client> | null} */
let clientPromise = null;

/**
 * Lazily connects a Temporal client for API use (workflow starts).
 * Uses same env vars as worker/demo scripts.
 */
function getTemporalClient() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const address = process.env.TEMPORAL_ADDRESS || '127.0.0.1:7233';
      const namespace = process.env.TEMPORAL_NAMESPACE || 'default';
      const connection = await withRetry('Temporal API client', () =>
        Connection.connect({ address, tls: false })
      );
      return new Client({ connection, namespace });
    })();
  }
  return clientPromise;
}

module.exports = { getTemporalClient };
