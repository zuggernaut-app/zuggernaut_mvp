'use strict';

const {
  withProviderRateLimit,
  resetProviderRateLimitsForTests,
  MIN_INTERVAL_MS,
} = require('../lib/providerRateLimit');

describe('providerRateLimit', () => {
  beforeEach(() => {
    resetProviderRateLimitsForTests();
  });

  it('serializes calls for the same provider key', async () => {
    const timestamps = [];

    await Promise.all([
      withProviderRateLimit('google_ads', async () => {
        timestamps.push(Date.now());
      }),
      withProviderRateLimit('google_ads', async () => {
        timestamps.push(Date.now());
      }),
    ]);

    expect(timestamps).toHaveLength(2);
    expect(timestamps[1] - timestamps[0]).toBeGreaterThanOrEqual(MIN_INTERVAL_MS - 5);
  });

  it('does not block unrelated provider keys', async () => {
    const start = Date.now();
    await Promise.all([
      withProviderRateLimit('gtm', async () => {}),
      withProviderRateLimit('google_ads', async () => {}),
    ]);
    expect(Date.now() - start).toBeLessThan(MIN_INTERVAL_MS * 2);
  });
});
