'use strict';

const axios = require('axios');
const { resetProviderRateLimitsForTests } = require('../lib/providerRateLimit');

jest.mock('axios');

const {
  GtmApiError,
  createGtmWorkspaceResource,
  parseRetryAfterMs,
  gtmRateLimitWaitMs,
} = require('../services/integrations/googleTagManagerClient');

describe('googleTagManagerClient rate limit handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetProviderRateLimitsForTests();
    process.env.GTM_API_MOCK = 'false';
    process.env.GTM_API_ENABLED = 'true';
    process.env.GTM_RATE_LIMIT_MAX_ATTEMPTS = '3';
    process.env.GTM_RATE_LIMIT_BASE_MS = '10';
    process.env.GTM_RATE_LIMIT_MAX_WAIT_MS = '100';
    axios.get.mockResolvedValue({ status: 200, data: { trigger: [] } });
  });

  it('parseRetryAfterMs parses seconds', () => {
    expect(parseRetryAfterMs('2')).toBe(2000);
  });

  it('gtmRateLimitWaitMs uses exponential backoff when Retry-After is absent', () => {
    jest.spyOn(Math, 'random').mockReturnValue(0);
    expect(gtmRateLimitWaitMs(0, undefined)).toBe(10);
    expect(gtmRateLimitWaitMs(1, undefined)).toBe(20);
    Math.random.mockRestore();
  });

  it('createGtmWorkspaceResource retries on 429 then succeeds', async () => {
    axios.post
      .mockResolvedValueOnce({ status: 429, headers: {}, data: {} })
      .mockResolvedValueOnce({
        status: 200,
        data: { path: 'accounts/a/containers/c/workspaces/w/triggers/1' },
      });

    const result = await createGtmWorkspaceResource({
      gtmIds: { accountId: 'a', containerId: 'c', workspaceId: 'w' },
      accessToken: 'token',
      collection: 'triggers',
      payload: { name: 'trig_test', type: 'click' },
      logicalKey: 'trig_test',
    });

    expect(result.resourcePath).toBe('accounts/a/containers/c/workspaces/w/triggers/1');
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('createGtmWorkspaceResource throws GTM_RATE_LIMITED after exhausting client retries', async () => {
    axios.post.mockResolvedValue({ status: 429, headers: {}, data: {} });

    await expect(
      createGtmWorkspaceResource({
        gtmIds: { accountId: 'a', containerId: 'c', workspaceId: 'w' },
        accessToken: 'token',
        collection: 'triggers',
        payload: { name: 'trig_test', type: 'click' },
        logicalKey: 'trig_test',
      })
    ).rejects.toMatchObject({ code: 'GTM_RATE_LIMITED' });

    expect(axios.post).toHaveBeenCalledTimes(3);
  });

  it('createGtmWorkspaceResource honors Retry-After header delay', async () => {
    jest.useFakeTimers();
    axios.post
      .mockResolvedValueOnce({ status: 429, headers: { 'retry-after': '1' }, data: {} })
      .mockResolvedValueOnce({
        status: 200,
        data: { path: 'accounts/a/containers/c/workspaces/w/triggers/2' },
      });

    const pending = createGtmWorkspaceResource({
      gtmIds: { accountId: 'a', containerId: 'c', workspaceId: 'w' },
      accessToken: 'token',
      collection: 'triggers',
      payload: { name: 'trig_retry_after', type: 'click' },
      logicalKey: 'trig_retry_after',
    });

    await jest.advanceTimersByTimeAsync(1000);
    const result = await pending;

    expect(result.resourcePath).toContain('/triggers/2');
    expect(axios.post).toHaveBeenCalledTimes(2);
    jest.useRealTimers();
  });
});

describe('GtmApiError rate limit code', () => {
  it('keeps GTM_RATE_LIMITED classification', () => {
    const err = new GtmApiError('GTM triggers create failed (429)', 'GTM_RATE_LIMITED');
    expect(err.code).toBe('GTM_RATE_LIMITED');
  });
});
