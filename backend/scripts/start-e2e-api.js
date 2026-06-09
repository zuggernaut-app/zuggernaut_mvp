'use strict';

/**
 * Starts Express after binding an ephemeral in-memory MongoDB so Playwright doesn't require a local mongod.
 * Used only for frontend E2E (`frontend/playwright.config.ts`).
 */

const path = require('path');
const { MongoMemoryServer } = require('mongodb-memory-server');

const FALLBACK_JWT_SECRET = 'playwright-e2e-jwt-secret-at-least-thirty-two-chars-xx';
const FALLBACK_TOKEN_ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

async function main() {
  const mongo = await MongoMemoryServer.create();

  /** @note `server.js` reads this on load (fallback is real localhost dev DB). */
  process.env.MONGODB_URI = mongo.getUri();

  if (!process.env.JWT_SECRET || String(process.env.JWT_SECRET).length < 32) {
    process.env.JWT_SECRET = FALLBACK_JWT_SECRET;
  }

  if (!process.env.TOKEN_ENCRYPTION_KEY?.trim()) {
    process.env.TOKEN_ENCRYPTION_KEY = FALLBACK_TOKEN_ENCRYPTION_KEY;
  }

  process.env.GOOGLE_OAUTH_MOCK = process.env.GOOGLE_OAUTH_MOCK ?? 'true';
  process.env.GTM_API_MOCK = process.env.GTM_API_MOCK ?? 'true';
  process.env.GOOGLE_ADS_API_MOCK = process.env.GOOGLE_ADS_API_MOCK ?? 'true';
  process.env.GBP_API_MOCK = process.env.GBP_API_MOCK ?? 'true';
  process.env.GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? 'playwright-e2e-google-client-id';
  process.env.GOOGLE_CLIENT_SECRET =
    process.env.GOOGLE_CLIENT_SECRET ?? 'playwright-e2e-google-client-secret';
  process.env.FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://127.0.0.1:5173';
  process.env.TEMPORAL_E2E_MOCK = process.env.TEMPORAL_E2E_MOCK ?? 'true';

  require(path.join(__dirname, '..', 'server.js'));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
