'use strict';

const axios = require('axios');
const { resetProviderRateLimitsForTests } = require('../lib/providerRateLimit');

jest.mock('axios');

const {
  GtmApiError,
  createGtmWorkspaceResource,
  createGtmContainerVersion,
  publishGtmContainerVersion,
  createAndPublishContainerVersion,
} = require('../services/integrations/googleTagManagerClient');

const gtmIds = { accountId: 'a', containerId: 'c', workspaceId: 'w' };
const accessToken = 'token';

describe('googleTagManagerClient mutations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetProviderRateLimitsForTests();
    process.env.GTM_API_MOCK = 'false';
    process.env.GTM_API_ENABLED = 'true';
    axios.get.mockResolvedValue({ status: 200, data: { trigger: [], tag: [], variable: [] } });
  });

  it('creates a trigger via workspace resource mutate', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { path: 'accounts/a/containers/c/workspaces/w/triggers/1' },
    });

    const result = await createGtmWorkspaceResource({
      gtmIds,
      accessToken,
      collection: 'triggers',
      payload: { name: 'zug_call_click', type: 'click' },
      logicalKey: 'zug_call_click',
    });

    expect(result.resourcePath).toBe('accounts/a/containers/c/workspaces/w/triggers/1');
    expect(result.source).toBe('gtm_api');
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/workspaces/w/triggers'),
      { name: 'zug_call_click', type: 'click' },
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer token' }),
      })
    );
  });

  it('creates a tag via workspace resource mutate', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { path: 'accounts/a/containers/c/workspaces/w/tags/2' },
    });

    const result = await createGtmWorkspaceResource({
      gtmIds,
      accessToken,
      collection: 'tags',
      payload: { name: 'zug_ads_conversion', type: 'awct' },
      logicalKey: 'zug_ads_conversion',
    });

    expect(result.resourcePath).toContain('/tags/2');
    expect(result.source).toBe('gtm_api');
  });

  it('creates a variable via workspace resource mutate', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { path: 'accounts/a/containers/c/workspaces/w/variables/3' },
    });

    const result = await createGtmWorkspaceResource({
      gtmIds,
      accessToken,
      collection: 'variables',
      payload: { name: 'zug_conversion_id', type: 'c', parameter: [{ key: 'value', value: 'AW-123' }] },
      logicalKey: 'zug_conversion_id',
    });

    expect(result.resourcePath).toContain('/variables/3');
    expect(result.source).toBe('gtm_api');
  });

  it('reuses an existing workspace resource when list matches payload', async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: {
        trigger: [
          {
            name: 'zug_call_click',
            type: 'click',
            path: 'accounts/a/containers/c/workspaces/w/triggers/existing',
          },
        ],
      },
    });

    const result = await createGtmWorkspaceResource({
      gtmIds,
      accessToken,
      collection: 'triggers',
      payload: { name: 'zug_call_click', type: 'click' },
      logicalKey: 'zug_call_click',
    });

    expect(result.resourcePath).toBe('accounts/a/containers/c/workspaces/w/triggers/existing');
    expect(result.source).toBe('gtm_api_reused');
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('throws GTM_CREATE_FAILED when variable create returns 400 without reusable match', async () => {
    axios.post.mockResolvedValue({
      status: 400,
      data: { error: { message: 'Workspace is already submitted.' } },
    });

    await expect(
      createGtmWorkspaceResource({
        gtmIds,
        accessToken,
        collection: 'variables',
        payload: { name: 'zug_var', type: 'c' },
        logicalKey: 'zug_var',
      })
    ).rejects.toMatchObject({ code: 'GTM_CREATE_FAILED' });
  });

  it('creates a container version', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        containerVersion: {
          containerVersionId: '7',
          path: 'accounts/a/containers/c/workspaces/w/versions/7',
        },
      },
    });

    const result = await createGtmContainerVersion({
      gtmIds,
      accessToken,
      versionName: 'Zuggernaut setup run1',
    });

    expect(result.containerVersionId).toBe('7');
    expect(result.versionPath).toContain('/versions/7');
    expect(result.source).toBe('gtm_api');
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining(':create_version'),
      expect.objectContaining({ name: 'Zuggernaut setup run1' }),
      expect.any(Object)
    );
  });

  it('publishes a container version', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        containerVersion: {
          path: 'accounts/a/containers/c/versions/7',
        },
      },
    });

    const result = await publishGtmContainerVersion({
      gtmIds,
      accessToken,
      containerVersionId: '7',
    });

    expect(result.publishedVersionPath).toBe('accounts/a/containers/c/versions/7');
    expect(result.source).toBe('gtm_api');
    expect(axios.post).toHaveBeenCalledWith(
      expect.stringContaining('/versions/7:publish'),
      {},
      expect.any(Object)
    );
  });

  it('createAndPublishContainerVersion creates then publishes', async () => {
    axios.post
      .mockResolvedValueOnce({
        status: 200,
        data: {
          containerVersion: {
            containerVersionId: '9',
            path: 'accounts/a/containers/c/workspaces/w/versions/9',
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          containerVersion: {
            path: 'accounts/a/containers/c/versions/9',
          },
        },
      });

    const result = await createAndPublishContainerVersion({
      gtmIds,
      accessToken,
      setupRunId: 'run1',
    });

    expect(result.versionPath).toContain('/versions/9');
    expect(result.publishedVersionPath).toBe('accounts/a/containers/c/versions/9');
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('throws GtmApiError when publish fails', async () => {
    axios.post.mockResolvedValue({
      status: 403,
      data: { error: { message: 'permission denied' } },
    });

    await expect(
      publishGtmContainerVersion({
        gtmIds,
        accessToken,
        containerVersionId: '7',
      })
    ).rejects.toBeInstanceOf(GtmApiError);
  });
});
