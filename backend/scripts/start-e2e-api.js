'use strict';

/**
 * Starts Express after binding an ephemeral in-memory MongoDB so Playwright doesn't require a local mongod.
 * Used only for frontend E2E (`frontend/playwright.config.ts`).
 */

const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');

const FALLBACK_JWT_SECRET = 'playwright-e2e-jwt-secret-at-least-thirty-two-chars-xx';

async function main() {
  const mongo = await MongoMemoryServer.create();

  /** @note `server.js` reads this on load (fallback is real localhost dev DB). */
  process.env.MONGODB_URI = mongo.getUri();

  if (!process.env.JWT_SECRET || String(process.env.JWT_SECRET).length < 32) {
    process.env.JWT_SECRET = FALLBACK_JWT_SECRET;
  }

  require(path.join(__dirname, '..', 'server.js'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
