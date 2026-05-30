'use strict';

const chains = new Map();

const MIN_INTERVAL_MS = Number(process.env.PROVIDER_RATE_LIMIT_MS || 200);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Serialize provider API calls per key with a minimum spacing interval.
 * @param {string} providerKey — e.g. google_ads, gtm, google_oauth
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withProviderRateLimit(providerKey, fn) {
  const key = String(providerKey);
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev
    .catch(() => {})
    .then(async () => {
      await sleep(MIN_INTERVAL_MS);
      return fn();
    });
  chains.set(key, run);
  return run;
}

function resetProviderRateLimitsForTests() {
  chains.clear();
}

module.exports = {
  withProviderRateLimit,
  resetProviderRateLimitsForTests,
  MIN_INTERVAL_MS,
};
