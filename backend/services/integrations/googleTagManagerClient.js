'use strict';

const axios = require('axios');
const { withProviderRateLimit } = require('../../lib/providerRateLimit');
const { getFreshGoogleAccessToken } = require('./googleTokenService');

const GTM_API_BASE = 'https://tagmanager.googleapis.com/tagmanager/v2';
const { buildDiscoveryResult } = require('./providerDiscoveryResult');

class GtmApiError extends Error {
  constructor(message, code = 'GTM_API_ERROR') {
    super(message);
    this.name = 'GtmApiError';
    this.code = code;
  }
}

/**
 * @param {object} ids
 */
function workspaceBasePath(ids) {
  return `accounts/${ids.accountId}/containers/${ids.containerId}/workspaces/${ids.workspaceId}`;
}

/**
 * @param {object} ids
 * @param {'variables' | 'triggers' | 'tags'} collection
 * @param {string} logicalKey
 */
function mockResourcePath(ids, collection, logicalKey) {
  return `${workspaceBasePath(ids)}/${collection}/${logicalKey}`;
}

/**
 * @param {object} ctx
 * @param {object} ctx.gtmIds
 * @param {string} ctx.accessToken
 * @param {'variables' | 'triggers' | 'tags'} ctx.collection
 * @param {object} ctx.payload
 * @param {string} ctx.logicalKey
 */
async function createGtmWorkspaceResource(ctx) {
  const { gtmIds, accessToken, collection, payload, logicalKey } = ctx;

  if (process.env.GTM_API_MOCK === 'true') {
    return {
      resourcePath: mockResourcePath(gtmIds, collection, logicalKey),
      source: 'gtm_api_mock',
    };
  }

  if (process.env.GTM_API_ENABLED !== 'true') {
    throw new GtmApiError(
      'GTM API is not enabled (set GTM_API_ENABLED=true after configuring credentials).',
      'GTM_API_NOT_ENABLED'
    );
  }

  const url = `${GTM_API_BASE}/${workspaceBasePath(gtmIds)}/${collection}`;
  const res = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
    validateStatus: () => true,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new GtmApiError(`GTM ${collection} create failed (${res.status})`, 'GTM_CREATE_FAILED');
  }

  const pathKey = collection.slice(0, -1);
  const resourcePath = res.data?.path ?? res.data?.[pathKey]?.path ?? null;
  if (!resourcePath) {
    throw new GtmApiError(`GTM ${collection} create returned no resource path`, 'GTM_CREATE_INVALID_RESPONSE');
  }

  return { resourcePath, source: 'gtm_api' };
}

/**
 * @param {object} ctx
 * @param {object} ctx.gtmIds
 * @param {string} ctx.accessToken
 * @param {string} ctx.setupRunId
 */
async function createAndPublishContainerVersion(ctx) {
  const { gtmIds, accessToken, setupRunId } = ctx;
  const base = workspaceBasePath(gtmIds);

  if (process.env.GTM_API_MOCK === 'true') {
    const versionPath = `${base}/versions/zug-${setupRunId}`;
    return {
      versionPath,
      publishedVersionPath: versionPath,
      source: 'gtm_api_mock',
    };
  }

  if (process.env.GTM_API_ENABLED !== 'true') {
    throw new GtmApiError(
      'GTM API is not enabled (set GTM_API_ENABLED=true after configuring credentials).',
      'GTM_API_NOT_ENABLED'
    );
  }

  const createUrl = `${GTM_API_BASE}/${base}:create_version`;
  const createRes = await axios.post(
    createUrl,
    { name: `Zuggernaut setup ${setupRunId}`, notes: 'Published by Zuggernaut V1 GTM conversion setup' },
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
      validateStatus: () => true,
    }
  );

  if (createRes.status < 200 || createRes.status >= 300) {
    throw new GtmApiError(
      `GTM container version create failed (${createRes.status})`,
      'GTM_VERSION_CREATE_FAILED'
    );
  }

  const containerVersion = createRes.data?.containerVersion;
  const containerVersionId = containerVersion?.containerVersionId;
  const versionPath = containerVersion?.path ?? null;

  if (!containerVersionId || !versionPath) {
    throw new GtmApiError('GTM container version create returned no version id', 'GTM_VERSION_INVALID_RESPONSE');
  }

  const publishUrl = `${GTM_API_BASE}/accounts/${gtmIds.accountId}/containers/${gtmIds.containerId}/versions/${containerVersionId}:publish`;

  const publishRes = await axios.post(
    publishUrl,
    {},
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 30000,
      validateStatus: () => true,
    }
  );

  if (publishRes.status < 200 || publishRes.status >= 300) {
    throw new GtmApiError(`GTM container version publish failed (${publishRes.status})`, 'GTM_PUBLISH_FAILED');
  }

  const publishedPath =
    publishRes.data?.containerVersion?.path ?? versionPath;

  return {
    versionPath,
    publishedVersionPath: publishedPath,
    source: 'gtm_api',
  };
}

/**
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 */
async function getGtmAccessToken(ctx) {
  return getFreshGoogleAccessToken({ businessId: ctx.businessId, provider: 'gtm' });
}

/**
 * @param {string} accessToken
 * @param {string} urlPath
 */
async function gtmGet(accessToken, urlPath) {
  const url = `${GTM_API_BASE}/${urlPath.replace(/^\/+/, '')}`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 30000,
    validateStatus: () => true,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new GtmApiError(`GTM GET ${urlPath} failed (${res.status})`, 'GTM_LIST_FAILED');
  }

  return res.data;
}

/**
 * @param {string} accessToken
 * @param {string} urlPath
 * @param {object} body
 */
async function gtmPost(accessToken, urlPath, body) {
  const url = `${GTM_API_BASE}/${urlPath.replace(/^\/+/, '')}`;
  const res = await axios.post(url, body, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
    validateStatus: () => true,
  });

  if (res.status < 200 || res.status >= 300) {
    throw new GtmApiError(`GTM POST ${urlPath} failed (${res.status})`, 'GTM_CREATE_FAILED');
  }

  return res.data;
}

/**
 * @param {object} account
 */
function normalizeGtmAccount(account) {
  if (!account || typeof account !== 'object') return null;
  const accountId = account.accountId != null ? String(account.accountId) : null;
  if (!accountId) return null;
  return {
    accountId,
    name: account.name ?? null,
    path: account.path ?? `accounts/${accountId}`,
  };
}

/**
 * @param {object} container
 */
function normalizeGtmContainer(container) {
  if (!container || typeof container !== 'object') return null;
  const containerId = container.containerId != null ? String(container.containerId) : null;
  if (!containerId) return null;
  return {
    containerId,
    publicContainerId: container.publicId != null ? String(container.publicId) : null,
    name: container.name ?? null,
    path: container.path ?? null,
    usageContext: Array.isArray(container.usageContext) ? container.usageContext : [],
  };
}

/**
 * @param {object} workspace
 */
function normalizeGtmWorkspace(workspace) {
  if (!workspace || typeof workspace !== 'object') return null;
  const workspaceId = workspace.workspaceId != null ? String(workspace.workspaceId) : null;
  if (!workspaceId) return null;
  return {
    workspaceId,
    name: workspace.name ?? null,
    path: workspace.path ?? null,
  };
}

/**
 * @param {string} accessToken
 * @param {string} name
 */
async function createGtmAccount(accessToken, name) {
  if (process.env.GTM_API_MOCK === 'true') {
    const accountId = `mock-prov-account-${String(name).replace(/\s+/g, '-').toLowerCase()}`;
    return normalizeGtmAccount({
      accountId,
      name,
      path: `accounts/${accountId}`,
    });
  }

  if (process.env.GTM_API_ENABLED !== 'true') {
    throw new GtmApiError(
      'GTM API is not enabled (set GTM_API_ENABLED=true after configuring credentials).',
      'GTM_API_NOT_ENABLED'
    );
  }

  const data = await gtmPost(accessToken, 'accounts', {
    name,
    shareData: false,
  });
  const normalized = normalizeGtmAccount(data);
  if (!normalized) {
    throw new GtmApiError('GTM account create returned no accountId', 'GTM_CREATE_INVALID_RESPONSE');
  }
  return normalized;
}

/**
 * @param {string} accessToken
 * @param {string} accountId
 * @param {{ name: string, usageContext?: string[] }} input
 */
async function createGtmContainer(accessToken, accountId, input) {
  const { name, usageContext = ['web'] } = input;

  if (process.env.GTM_API_MOCK === 'true') {
    const containerId = `mock-prov-container-${String(name).replace(/\s+/g, '-').toLowerCase()}`;
    return normalizeGtmContainer({
      containerId,
      publicId: 'GTM-PROV',
      name,
      usageContext,
      path: `accounts/${accountId}/containers/${containerId}`,
    });
  }

  if (process.env.GTM_API_ENABLED !== 'true') {
    throw new GtmApiError(
      'GTM API is not enabled (set GTM_API_ENABLED=true after configuring credentials).',
      'GTM_API_NOT_ENABLED'
    );
  }

  const data = await gtmPost(accessToken, `accounts/${accountId}/containers`, {
    name,
    usageContext,
  });
  const normalized = normalizeGtmContainer(data);
  if (!normalized) {
    throw new GtmApiError('GTM container create returned no containerId', 'GTM_CREATE_INVALID_RESPONSE');
  }
  return normalized;
}

/**
 * @param {string} accessToken
 * @param {string} accountId
 * @param {string} containerId
 * @param {string} name
 */
async function createGtmWorkspace(accessToken, accountId, containerId, name) {
  if (process.env.GTM_API_MOCK === 'true') {
    const workspaceId = 'mock-prov-workspace';
    return normalizeGtmWorkspace({
      workspaceId,
      name,
      path: `accounts/${accountId}/containers/${containerId}/workspaces/${workspaceId}`,
    });
  }

  if (process.env.GTM_API_ENABLED !== 'true') {
    throw new GtmApiError(
      'GTM API is not enabled (set GTM_API_ENABLED=true after configuring credentials).',
      'GTM_API_NOT_ENABLED'
    );
  }

  const data = await gtmPost(
    accessToken,
    `accounts/${accountId}/containers/${containerId}/workspaces`,
    { name }
  );
  const normalized = normalizeGtmWorkspace(data);
  if (!normalized) {
    throw new GtmApiError('GTM workspace create returned no workspaceId', 'GTM_CREATE_INVALID_RESPONSE');
  }
  return normalized;
}

/**
 * List workspaces and return the first usable one, or create a default workspace.
 *
 * @param {string} accessToken
 * @param {string} accountId
 * @param {string} containerId
 * @param {{ workspaceName?: string }} [opts]
 */
async function resolveOrCreateWorkspace(accessToken, accountId, containerId, opts = {}) {
  const workspaceName = opts.workspaceName ?? 'Default Workspace';
  const workspaces = await listGtmWorkspaces(accessToken, accountId, containerId);
  const existing = selectGtmWorkspace(workspaces);
  if (existing) {
    return normalizeGtmWorkspace(existing);
  }
  return createGtmWorkspace(accessToken, accountId, containerId, workspaceName);
}

/**
 * @param {string} accessToken
 */
async function listGtmAccounts(accessToken) {
  if (process.env.GTM_API_MOCK === 'true') {
    return [{ accountId: 'mock-account', name: 'Mock Account', path: 'accounts/mock-account' }];
  }

  const data = await gtmGet(accessToken, 'accounts');
  return Array.isArray(data?.account) ? data.account : [];
}

/**
 * @param {string} accessToken
 * @param {string} accountId
 */
async function listGtmContainers(accessToken, accountId) {
  if (process.env.GTM_API_MOCK === 'true') {
    return [
      {
        containerId: 'mock-container',
        publicId: 'GTM-MOCK',
        name: 'Mock Web Container',
        usageContext: ['web'],
        path: `accounts/mock-account/containers/mock-container`,
      },
    ];
  }

  const data = await gtmGet(accessToken, `accounts/${accountId}/containers`);
  return Array.isArray(data?.container) ? data.container : [];
}

/**
 * @param {string} accessToken
 * @param {string} accountId
 * @param {string} containerId
 */
async function listGtmWorkspaces(accessToken, accountId, containerId) {
  if (process.env.GTM_API_MOCK === 'true') {
    return [
      {
        workspaceId: 'mock-workspace',
        name: 'Default Workspace',
        path: `accounts/mock-account/containers/mock-container/workspaces/mock-workspace`,
      },
    ];
  }

  const data = await gtmGet(accessToken, `accounts/${accountId}/containers/${containerId}/workspaces`);
  return Array.isArray(data?.workspace) ? data.workspace : [];
}

/**
 * Prefer web containers; fall back to first container with a workspace.
 *
 * @param {object[]} containers
 */
function selectGtmContainer(containers) {
  const withWeb = containers.filter(
    (c) => Array.isArray(c.usageContext) && c.usageContext.includes('web') && c.containerId
  );
  const pool = withWeb.length > 0 ? withWeb : containers.filter((c) => c.containerId);
  return pool.sort((a, b) => String(a.containerId).localeCompare(String(b.containerId), undefined, { numeric: true }))[0] ?? null;
}

/**
 * @param {object[]} workspaces
 */
function selectGtmWorkspace(workspaces) {
  return (
    workspaces
      .filter((w) => w.workspaceId)
      .sort((a, b) => String(a.workspaceId).localeCompare(String(b.workspaceId), undefined, { numeric: true }))[0] ??
    null
  );
}

/**
 * Read-only GTM hierarchy discovery — never creates accounts, containers, or workspaces.
 *
 * @param {string} accessToken
 */
async function discoverGtmProviderIdentifiers(accessToken) {
  try {
    const accounts = await listGtmAccounts(accessToken);
    const sortedAccounts = accounts
      .filter((a) => a.accountId)
      .sort((a, b) => String(a.accountId).localeCompare(String(b.accountId), undefined, { numeric: true }));

    for (const account of sortedAccounts) {
      const containers = await listGtmContainers(accessToken, account.accountId);
      const container = selectGtmContainer(containers);
      if (!container) continue;

      const workspaces = await listGtmWorkspaces(accessToken, account.accountId, container.containerId);
      const workspace = selectGtmWorkspace(workspaces);
      if (!workspace) continue;

      return buildDiscoveryResult('gtm', {
        accountId: String(account.accountId),
        containerId: String(container.containerId),
        workspaceId: String(workspace.workspaceId),
        ...(container.publicId ? { publicContainerId: String(container.publicId) } : {}),
      });
    }

    return buildDiscoveryResult('gtm', {
      discoveryReason: 'GTM_PROVISIONING_REQUIRED',
    });
  } catch (err) {
    return buildDiscoveryResult('gtm', {
      discoveryError: err.code ?? 'GTM_DISCOVERY_FAILED',
      discoveryReason: 'GTM_PROVISIONING_REQUIRED',
    });
  }
}

module.exports = {
  GtmApiError,
  workspaceBasePath,
  mockResourcePath,
  gtmGet,
  gtmPost,
  normalizeGtmAccount,
  normalizeGtmContainer,
  normalizeGtmWorkspace,
  listGtmAccounts: (accessToken) => withProviderRateLimit('gtm', () => listGtmAccounts(accessToken)),
  listGtmContainers: (accessToken, accountId) =>
    withProviderRateLimit('gtm', () => listGtmContainers(accessToken, accountId)),
  listGtmWorkspaces: (accessToken, accountId, containerId) =>
    withProviderRateLimit('gtm', () => listGtmWorkspaces(accessToken, accountId, containerId)),
  createGtmAccount: (accessToken, name) =>
    withProviderRateLimit('gtm', () => createGtmAccount(accessToken, name)),
  createGtmContainer: (accessToken, accountId, input) =>
    withProviderRateLimit('gtm', () => createGtmContainer(accessToken, accountId, input)),
  createGtmWorkspace: (accessToken, accountId, containerId, name) =>
    withProviderRateLimit('gtm', () => createGtmWorkspace(accessToken, accountId, containerId, name)),
  resolveOrCreateWorkspace: (accessToken, accountId, containerId, opts) =>
    withProviderRateLimit('gtm', () => resolveOrCreateWorkspace(accessToken, accountId, containerId, opts)),
  discoverGtmProviderIdentifiers: (accessToken) =>
    withProviderRateLimit('gtm', () => discoverGtmProviderIdentifiers(accessToken)),
  createGtmWorkspaceResource: (ctx) => withProviderRateLimit('gtm', () => createGtmWorkspaceResource(ctx)),
  createAndPublishContainerVersion: (ctx) =>
    withProviderRateLimit('gtm', () => createAndPublishContainerVersion(ctx)),
  getGtmAccessToken,
};
