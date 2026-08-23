'use strict';

const axios = require('axios');
const { withProviderRateLimit } = require('../../lib/providerRateLimit');
const { createLogger } = require('../../lib/observability/logger');
const { getFreshGoogleAccessToken } = require('./googleTokenService');

const gtmClientLogger = createLogger({ name: 'googleTagManagerClient' });

const GTM_RATE_LIMIT_MAX_ATTEMPTS_DEFAULT = 5;
const GTM_RATE_LIMIT_BASE_MS_DEFAULT = 2000;
const GTM_RATE_LIMIT_MAX_WAIT_MS_DEFAULT = 60_000;

function getGtmRateLimitMaxAttempts() {
  return Number(process.env.GTM_RATE_LIMIT_MAX_ATTEMPTS || GTM_RATE_LIMIT_MAX_ATTEMPTS_DEFAULT);
}

function getGtmRateLimitBaseMs() {
  return Number(process.env.GTM_RATE_LIMIT_BASE_MS || GTM_RATE_LIMIT_BASE_MS_DEFAULT);
}

function getGtmRateLimitMaxWaitMs() {
  return Number(process.env.GTM_RATE_LIMIT_MAX_WAIT_MS || GTM_RATE_LIMIT_MAX_WAIT_MS_DEFAULT);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {string | number | string[] | undefined} retryAfter
 * @returns {number | null}
 */
function parseRetryAfterMs(retryAfter) {
  const raw = Array.isArray(retryAfter) ? retryAfter[0] : retryAfter;
  if (raw == null || raw === '') {
    return null;
  }

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.ceil(seconds * 1000);
  }

  const dateMs = Date.parse(String(raw));
  if (Number.isFinite(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? delta : 0;
  }

  return null;
}

/**
 * @param {number} attempt — zero-based retry index after the first 429
 * @param {string | number | string[] | undefined} retryAfterHeader
 */
function gtmRateLimitWaitMs(attempt, retryAfterHeader) {
  const fromHeader = parseRetryAfterMs(retryAfterHeader);
  if (fromHeader != null) {
    return Math.min(fromHeader, getGtmRateLimitMaxWaitMs());
  }

  const jitterMs = Math.floor(Math.random() * 250);
  return Math.min(getGtmRateLimitBaseMs() * 2 ** attempt + jitterMs, getGtmRateLimitMaxWaitMs());
}

/**
 * @param {string} url
 * @param {object} body
 * @param {import('axios').AxiosRequestConfig} axiosConfig
 * @param {{ collection: string, operation?: string }} logContext
 */
async function axiosPostWithGtmRateLimitRetry(url, body, axiosConfig, logContext) {
  const maxAttempts = getGtmRateLimitMaxAttempts();
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const res = await axios.post(url, body, axiosConfig);
    if (res.status !== 429) {
      return res;
    }

    if (attempt >= maxAttempts - 1) {
      throw new GtmApiError(
        `GTM ${logContext.collection} create failed (429)`,
        'GTM_RATE_LIMITED'
      );
    }

    const waitMs = gtmRateLimitWaitMs(attempt, res.headers?.['retry-after']);
    gtmClientLogger.warn(
      {
        operation: logContext.operation ?? 'workspace_resource_create',
        collection: logContext.collection,
        attempt: attempt + 1,
        maxAttempts,
        waitMs,
        status: 429,
        url,
      },
      'GTM API rate limited; retrying'
    );
    await sleep(waitMs);
  }

  throw new GtmApiError(`GTM ${logContext.collection} create failed (429)`, 'GTM_RATE_LIMITED');
}

const GTM_API_BASE = 'https://tagmanager.googleapis.com/tagmanager/v2';
const {
  buildDiscoveryResult,
  buildSelectionRequiredResult,
  defaultSelectionReason,
} = require('./providerDiscoveryResult');

class GtmApiError extends Error {
  constructor(message, code = 'GTM_API_ERROR') {
    super(message);
    this.name = 'GtmApiError';
    this.code = code;
  }
}

class GtmWorkspaceResourceCollisionError extends GtmApiError {
  /**
   * @param {string} message
   * @param {object} collision
   */
  constructor(message, collision) {
    super(message, 'GTM_WORKSPACE_RESOURCE_COLLISION');
    this.name = 'GtmWorkspaceResourceCollisionError';
    this.collision = collision;
  }
}

/**
 * @param {unknown} err
 */
function isGtmWorkspaceResourceCollisionError(err) {
  return err instanceof GtmWorkspaceResourceCollisionError;
}

/**
 * @param {{ data?: object, status?: number }} res
 */
function formatGtmApiErrorSuffix(res) {
  const err = res?.data?.error;
  if (err && typeof err.message === 'string' && err.message.trim()) {
    const reason = err.errors?.[0]?.reason;
    return reason ? `: ${err.message} (${reason})` : `: ${err.message}`;
  }
  if (res?.data && typeof res.data.message === 'string' && res.data.message.trim()) {
    return `: ${res.data.message}`;
  }
  return '';
}

/**
 * @param {{ data?: object, status?: number }} res
 * @returns {string | null}
 */
function summarizeGtmApiResponseForLog(res) {
  const summary = formatGtmApiErrorSuffix(res).replace(/^:\s*/, '').trim();
  return summary || null;
}

/**
 * @param {{ status?: number, data?: object }} res
 */
function isGtmWorkspaceAlreadySubmittedResponse(res) {
  const message = String(res?.data?.error?.message ?? '').toLowerCase();
  return res?.status === 400 && message.includes('workspace is already submitted');
}

/**
 * @param {unknown} err
 */
function isGtmWorkspaceAlreadySubmittedError(err) {
  if (!(err instanceof GtmApiError)) {
    return false;
  }
  return String(err.message).toLowerCase().includes('workspace is already submitted');
}

/**
 * @param {object} payload
 */
function constantVariableValue(payload) {
  if (payload?.type !== 'c' || !Array.isArray(payload.parameter)) return null;
  const valueParam = payload.parameter.find((p) => p && p.key === 'value');
  return valueParam?.value != null ? String(valueParam.value) : null;
}

/**
 * Reuse an existing workspace resource only when name/type (and constant value) match intent.
 *
 * @param {object} existing — GTM API resource row
 * @param {object} payload — intended create body
 * @param {'variables' | 'triggers' | 'tags'} collection
 */
function workspaceResourceMatchesPayload(existing, payload, collection) {
  if (!existing || !payload?.name || existing.name !== payload.name) {
    return false;
  }
  if (payload.type && existing.type !== payload.type) {
    return false;
  }
  if (collection === 'variables' && payload.type === 'c') {
    const expected = constantVariableValue(payload);
    const actual = constantVariableValue(existing);
    if (expected != null && actual !== expected) {
      return false;
    }
  }
  return Boolean(existing.path);
}

/**
 * @param {string} accessToken
 * @param {object} gtmIds
 * @param {'variables' | 'triggers' | 'tags'} collection
 * @param {object} payload
 */
async function findMatchingWorkspaceResource(accessToken, gtmIds, collection, payload) {
  const items = await listGtmWorkspaceResources(accessToken, gtmIds, collection);
  const match = items.find((item) => workspaceResourceMatchesPayload(item, payload, collection));
  return match ?? null;
}

/**
 * @param {string} accessToken
 * @param {object} gtmIds
 * @param {'variables' | 'triggers' | 'tags'} collection
 * @param {string | undefined} name
 */
async function findWorkspaceResourceByName(accessToken, gtmIds, collection, name) {
  if (!name) return null;
  const items = await listGtmWorkspaceResources(accessToken, gtmIds, collection);
  return items.find((item) => item?.name === name) ?? null;
}

/**
 * @param {{ data?: object, status?: number }} res
 */
function isDuplicateNameApiResponse(res) {
  const message = String(res?.data?.error?.message ?? '').toLowerCase();
  const reason = res?.data?.error?.errors?.[0]?.reason;
  return message.includes('duplicate name') || reason === 'duplicateName';
}

/**
 * @param {object} ctx
 * @param {object} ctx.gtmIds
 * @param {object} ctx.payload
 * @param {string} ctx.logicalKey
 * @param {object} existing — GTM API resource row
 * @param {'variables' | 'triggers' | 'tags'} collection
 */
function buildWorkspaceResourceCollisionDetails(ctx, existing, collection) {
  const { gtmIds, payload, logicalKey } = ctx;
  const existingValue =
    collection === 'variables' && existing?.type === 'c' ? constantVariableValue(existing) : null;
  const payloadValue =
    collection === 'variables' && payload?.type === 'c' ? constantVariableValue(payload) : null;
  return {
    collection,
    logicalKey,
    payloadName: payload?.name,
    payloadType: payload?.type,
    payloadValue,
    existingPath: existing?.path,
    existingType: existing?.type,
    existingValue,
    accountId: gtmIds?.accountId,
    containerId: gtmIds?.containerId,
    workspaceId: gtmIds?.workspaceId,
  };
}

/**
 * @param {object} ctx
 * @param {object} existing — GTM API resource row
 * @param {'variables' | 'triggers' | 'tags'} collection
 */
function throwWorkspaceResourceCollision(ctx, existing, collection) {
  const { payload } = ctx;
  const collision = buildWorkspaceResourceCollisionDetails(ctx, existing, collection);
  throw new GtmWorkspaceResourceCollisionError(
    `GTM ${collection} name collision for "${payload?.name ?? ''}"`,
    collision
  );
}

/**
 * @param {string} accessToken
 * @param {object} gtmIds
 * @param {'variables' | 'triggers' | 'tags'} collection
 */
async function listGtmWorkspaceResources(accessToken, gtmIds, collection) {
  if (process.env.GTM_API_MOCK === 'true') {
    return [];
  }

  const listPath = `${workspaceBasePath(gtmIds)}/${collection}`;
  const data = await gtmGet(accessToken, listPath);
  const pathKey = collection.slice(0, -1);
  return Array.isArray(data?.[pathKey]) ? data[pathKey] : [];
}

/**
 * @param {object} ctx
 * @param {string} ctx.accessToken
 * @param {'variables' | 'triggers' | 'tags'} ctx.collection
 * @param {object} ctx.existing — GTM API resource row
 * @param {object} ctx.payload — intended resource body fields
 */
async function updateGtmWorkspaceResource(ctx) {
  const { accessToken, collection, existing, payload } = ctx;

  if (process.env.GTM_API_MOCK === 'true') {
    return { resourcePath: existing.path, source: 'gtm_api_mock' };
  }

  if (process.env.GTM_API_ENABLED !== 'true') {
    throw new GtmApiError(
      'GTM API is not enabled (set GTM_API_ENABLED=true after configuring credentials).',
      'GTM_API_NOT_ENABLED'
    );
  }

  const updateBody = {
    ...existing,
    ...payload,
    path: existing.path,
  };

  const url = `${GTM_API_BASE}/${existing.path}`;
  const res = await axios.put(url, updateBody, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
    validateStatus: () => true,
  });

  if (res.status < 200 || res.status >= 300) {
    gtmClientLogger.error(
      {
        operation: 'workspace_resource_update',
        collection,
        status: res.status,
        url,
        gtmErrorResponse: res.data ?? null,
      },
      'GTM workspace resource update failed'
    );
    throw new GtmApiError(
      `GTM ${collection} update failed (${res.status})${formatGtmApiErrorSuffix(res)}`,
      'GTM_UPDATE_FAILED'
    );
  }

  const pathKey = collection.slice(0, -1);
  const resourcePath = res.data?.path ?? res.data?.[pathKey]?.path ?? existing.path;
  return { resourcePath, source: 'gtm_api' };
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

  let reusablePath = null;
  let reusableResource = null;
  try {
    reusableResource = await findMatchingWorkspaceResource(accessToken, gtmIds, collection, payload);
    reusablePath = reusableResource?.path ?? null;
  } catch {
    reusablePath = null;
    reusableResource = null;
  }
  if (reusablePath) {
    return { resourcePath: reusablePath, source: 'gtm_api_reused' };
  }

  try {
    const sameNameResource = await findWorkspaceResourceByName(
      accessToken,
      gtmIds,
      collection,
      payload?.name
    );
    if (sameNameResource) {
      if (workspaceResourceMatchesPayload(sameNameResource, payload, collection)) {
        return { resourcePath: sameNameResource.path, source: 'gtm_api_reused' };
      }
      throwWorkspaceResourceCollision(ctx, sameNameResource, collection);
    }
  } catch (err) {
    if (isGtmWorkspaceResourceCollisionError(err)) {
      throw err;
    }
    /* list failed — proceed to create */
  }

  const res = await axiosPostWithGtmRateLimitRetry(
    url,
    payload,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
      validateStatus: () => true,
    },
    { collection, operation: 'workspace_resource_create' }
  );

  if (res.status === 400) {
    try {
      const onConflictResource = await findMatchingWorkspaceResource(
        accessToken,
        gtmIds,
        collection,
        payload
      );
      if (onConflictResource?.path) {
        return { resourcePath: onConflictResource.path, source: 'gtm_api_reused' };
      }
      if (isDuplicateNameApiResponse(res)) {
        const byName = await findWorkspaceResourceByName(accessToken, gtmIds, collection, payload?.name);
        if (byName) {
          if (workspaceResourceMatchesPayload(byName, payload, collection)) {
            return { resourcePath: byName.path, source: 'gtm_api_reused' };
          }
          throwWorkspaceResourceCollision(ctx, byName, collection);
        }
      }
    } catch (err) {
      if (isGtmWorkspaceResourceCollisionError(err)) {
        throw err;
      }
      /* fall through to error with API detail */
    }
  }

  if (res.status < 200 || res.status >= 300) {
    gtmClientLogger.error(
      {
        operation: 'workspace_resource_create',
        collection,
        logicalKey,
        status: res.status,
        url,
        payloadName: typeof payload?.name === 'string' ? payload.name : undefined,
        payloadType: typeof payload?.type === 'string' ? payload.type : undefined,
        accountId: gtmIds?.accountId,
        containerId: gtmIds?.containerId,
        workspaceId: gtmIds?.workspaceId,
        gtmErrorResponse: res.data ?? null,
      },
      'GTM workspace resource create failed'
    );
    throw new GtmApiError(
      `GTM ${collection} create failed (${res.status})${formatGtmApiErrorSuffix(res)}`,
      'GTM_CREATE_FAILED'
    );
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
/**
 * @param {object} ctx
 * @param {object} ctx.gtmIds
 * @param {string} ctx.accessToken
 * @param {string} ctx.versionName
 */
async function createGtmContainerVersion(ctx) {
  const { gtmIds, accessToken, versionName } = ctx;
  const base = workspaceBasePath(gtmIds);

  if (process.env.GTM_API_MOCK === 'true') {
    const versionPath = `${base}/versions/${String(versionName).replace(/\s+/g, '-').toLowerCase()}`;
    return {
      versionPath,
      containerVersionId: 'mock-version',
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
    { name: versionName, notes: 'Created by Zuggernaut dev creation diagnostics' },
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
    gtmClientLogger.error(
      {
        operation: 'create_version',
        status: createRes.status,
        url: createUrl,
        errorSummary: summarizeGtmApiResponseForLog(createRes),
      },
      'GTM container version create failed'
    );
    throw new GtmApiError(
      `GTM container version create failed (${createRes.status})${formatGtmApiErrorSuffix(createRes)}`,
      'GTM_VERSION_CREATE_FAILED'
    );
  }

  gtmClientLogger.info(
    {
      operation: 'create_version',
      status: createRes.status,
      url: createUrl,
      containerVersionId: createRes.data?.containerVersion?.containerVersionId ?? null,
      compilerError: createRes.data?.compilerError === true,
    },
    'GTM container version create succeeded'
  );

  if (createRes.data?.compilerError === true) {
    throw new GtmApiError(
      'GTM container version create failed due to compiler errors',
      'GTM_VERSION_COMPILER_ERROR'
    );
  }

  const containerVersion = createRes.data?.containerVersion;
  const containerVersionId = containerVersion?.containerVersionId;
  const versionPath = containerVersion?.path ?? null;

  if (!containerVersionId || !versionPath) {
    throw new GtmApiError('GTM container version create returned no version id', 'GTM_VERSION_INVALID_RESPONSE');
  }

  return {
    versionPath,
    containerVersionId: String(containerVersionId),
    source: 'gtm_api',
  };
}

/**
 * @param {object} ctx
 * @param {object} ctx.gtmIds
 * @param {string} ctx.accessToken
 * @param {string} ctx.containerVersionId
 */
async function publishGtmContainerVersion(ctx) {
  const { gtmIds, accessToken, containerVersionId } = ctx;

  if (process.env.GTM_API_MOCK === 'true') {
    const versionPath = `accounts/${gtmIds.accountId}/containers/${gtmIds.containerId}/versions/${containerVersionId}`;
    return {
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
    gtmClientLogger.error(
      {
        operation: 'publish',
        status: publishRes.status,
        url: publishUrl,
        containerVersionId,
        errorSummary: summarizeGtmApiResponseForLog(publishRes),
      },
      'GTM container version publish failed'
    );
    throw new GtmApiError(`GTM container version publish failed (${publishRes.status})`, 'GTM_PUBLISH_FAILED');
  }

  const publishedPath = publishRes.data?.containerVersion?.path ?? null;
  if (!publishedPath) {
    throw new GtmApiError('GTM container version publish returned no version path', 'GTM_PUBLISH_INVALID_RESPONSE');
  }

  return {
    publishedVersionPath: publishedPath,
    source: 'gtm_api',
  };
}

/**
 * @param {object} ctx
 * @param {object} ctx.gtmIds
 * @param {string} ctx.accessToken
 * @param {string} ctx.setupRunId
 */
async function createAndPublishContainerVersion(ctx) {
  const { gtmIds, accessToken, setupRunId } = ctx;
  const created = await createGtmContainerVersion({
    gtmIds,
    accessToken,
    versionName: `Zuggernaut setup ${setupRunId}`,
  });
  const published = await publishGtmContainerVersion({
    gtmIds,
    accessToken,
    containerVersionId: created.containerVersionId,
  });

  return {
    versionPath: created.versionPath,
    publishedVersionPath: published.publishedVersionPath,
    source: created.source,
  };
}

/**
 * @param {string} accessToken
 * @param {object} gtmIds
 * @param {string[]} types
 */
async function enableGtmBuiltinVariables(accessToken, gtmIds, types) {
  const base = workspaceBasePath(gtmIds);
  const requestedTypes = [...new Set(types.filter(Boolean).map(String))];

  if (process.env.GTM_API_MOCK === 'true') {
    return {
      enabledTypes: requestedTypes,
      source: 'gtm_api_mock',
    };
  }

  if (process.env.GTM_API_ENABLED !== 'true') {
    throw new GtmApiError(
      'GTM API is not enabled (set GTM_API_ENABLED=true after configuring credentials).',
      'GTM_API_NOT_ENABLED'
    );
  }

  if (requestedTypes.length === 0) {
    return { enabledTypes: [], source: 'gtm_api' };
  }

  const listData = await gtmGet(accessToken, `${base}/built_in_variables`);
  const alreadyEnabled = new Set(
    (listData?.builtInVariable ?? [])
      .map((row) => row?.type)
      .filter(Boolean)
      .map(String)
  );
  const toEnable = requestedTypes.filter((type) => !alreadyEnabled.has(type));

  if (toEnable.length === 0) {
    return { enabledTypes: requestedTypes, source: 'gtm_api' };
  }

  const urlPath = `${base}/built_in_variables`;
  const url = `${GTM_API_BASE}/${urlPath.replace(/^\/+/, '')}`;
  const res = await axios.post(
    url,
    {},
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      params: { type: toEnable },
      paramsSerializer: (params) => {
        const search = new URLSearchParams();
        for (const type of params.type) {
          search.append('type', type);
        }
        return search.toString();
      },
      timeout: 30000,
      validateStatus: () => true,
    }
  );

  if (res.status < 200 || res.status >= 300) {
    throw new GtmApiError(
      `GTM built-in variables enable failed (${res.status})${formatGtmApiErrorSuffix(res)}`,
      'GTM_BUILTIN_VARIABLE_ENABLE_FAILED'
    );
  }

  const enabledNow = (res.data?.builtInVariable ?? [])
    .map((row) => row?.type)
    .filter(Boolean)
    .map(String);

  return {
    enabledTypes: [...new Set([...alreadyEnabled, ...enabledNow, ...toEnable])].filter((type) =>
      requestedTypes.includes(type)
    ),
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
 * @param {string} accountId
 * @param {string} containerId
 */
async function fetchGtmLiveContainerVersionPath(accessToken, accountId, containerId) {
  if (process.env.GTM_API_MOCK === 'true') {
    return {
      path: `accounts/${accountId}/containers/${containerId}/versions/mock-live`,
      containerVersionId: 'mock-live',
      source: 'gtm_api_mock',
    };
  }

  if (process.env.GTM_API_ENABLED !== 'true') {
    throw new GtmApiError(
      'GTM API is not enabled (set GTM_API_ENABLED=true after configuring credentials).',
      'GTM_API_NOT_ENABLED'
    );
  }

  const data = await gtmGet(accessToken, `accounts/${accountId}/containers/${containerId}/versions:live`);
  const path = data?.path ?? data?.containerVersion?.path ?? null;
  const containerVersionId =
    data?.containerVersionId != null
      ? String(data.containerVersionId)
      : data?.containerVersion?.containerVersionId != null
        ? String(data.containerVersion.containerVersionId)
        : null;

  if (!path) {
    throw new GtmApiError('GTM live version fetch returned no version path', 'GTM_LIVE_VERSION_INVALID');
  }

  return {
    path,
    containerVersionId,
    source: 'gtm_api',
  };
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

  throw new GtmApiError(
    'GTM accounts cannot be created via API. Create an account manually in Google Tag Manager first.',
    'GTM_ACCOUNT_CREATE_NOT_SUPPORTED'
  );
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

    if (sortedAccounts.length === 0) {
      return buildDiscoveryResult('gtm', {
        discoveryReason: 'GTM_ACCOUNT_NOT_FOUND',
      });
    }

    let containerCount = 0;
    let workspaceCount = 0;

    for (const account of sortedAccounts) {
      const containers = await listGtmContainers(accessToken, account.accountId);
      const webContainers = containers.filter(
        (c) => Array.isArray(c.usageContext) && c.usageContext.includes('web') && c.containerId
      );
      const pool = webContainers.length > 0 ? webContainers : containers.filter((c) => c.containerId);
      containerCount += pool.length;

      for (const container of pool) {
        const workspaces = await listGtmWorkspaces(
          accessToken,
          account.accountId,
          container.containerId
        );
        workspaceCount += workspaces.filter((w) => w.workspaceId).length;
      }
    }

    if (containerCount === 0 || workspaceCount === 0) {
      return buildDiscoveryResult('gtm', {
        discoveryReason: 'GTM_PROVISIONING_REQUIRED',
      });
    }

    return buildSelectionRequiredResult(
      'gtm',
      {
        discoveredAccountCount: sortedAccounts.length,
        discoveredContainerCount: containerCount,
        discoveredWorkspaceCount: workspaceCount,
        discoveryRecordedAt: new Date().toISOString(),
      },
      defaultSelectionReason('gtm')
    );
  } catch (err) {
    return buildDiscoveryResult('gtm', {
      discoveryError: err.code ?? 'GTM_DISCOVERY_FAILED',
      discoveryReason: 'GTM_PROVISIONING_REQUIRED',
    });
  }
}

module.exports = {
  GtmApiError,
  GtmWorkspaceResourceCollisionError,
  isGtmWorkspaceResourceCollisionError,
  isGtmWorkspaceAlreadySubmittedResponse,
  isGtmWorkspaceAlreadySubmittedError,
  parseRetryAfterMs,
  gtmRateLimitWaitMs,
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
  listGtmWorkspaceResources: (accessToken, gtmIds, collection) =>
    withProviderRateLimit('gtm', () => listGtmWorkspaceResources(accessToken, gtmIds, collection)),
  updateGtmWorkspaceResource: (ctx) =>
    withProviderRateLimit('gtm', () => updateGtmWorkspaceResource(ctx)),
  createGtmContainerVersion: (ctx) => withProviderRateLimit('gtm', () => createGtmContainerVersion(ctx)),
  publishGtmContainerVersion: (ctx) => withProviderRateLimit('gtm', () => publishGtmContainerVersion(ctx)),
  createAndPublishContainerVersion: (ctx) =>
    withProviderRateLimit('gtm', () => createAndPublishContainerVersion(ctx)),
  fetchGtmLiveContainerVersionPath: (accessToken, accountId, containerId) =>
    withProviderRateLimit('gtm', () =>
      fetchGtmLiveContainerVersionPath(accessToken, accountId, containerId)
    ),
  enableGtmBuiltinVariables: (accessToken, gtmIds, types) =>
    withProviderRateLimit('gtm', () => enableGtmBuiltinVariables(accessToken, gtmIds, types)),
  getGtmAccessToken,
};
