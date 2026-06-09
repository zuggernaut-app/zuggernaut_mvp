'use strict';

const crypto = require('crypto');
const { mongoose } = require('../../shared');
const {
  gtmGet,
  gtmPost,
  workspaceBasePath,
  listGtmAccounts,
  listGtmContainers,
  listGtmWorkspaces,
  createGtmWorkspaceResource,
} = require('../../../../backend/services/integrations/googleTagManagerClient');
const { getFreshGoogleAccessToken } = require('../../../../backend/services/integrations/googleTokenService');
const { getOAuthRedirectUri } = require('../../../../backend/services/integrations/googleOAuthService');
const { allScopesForProvider } = require('../../../../backend/constants/googleOAuth');
const {
  stage,
  traceTokenCrypto,
  traceBusinessContext,
  traceStoredConnection,
  traceConnectionStatus,
  traceTokenRefresh,
  traceConnectUrl,
  buildOAuthTraceReport,
  finalizeStagedReport,
} = require('./oauthLabShared');

const IntegrationConnection = mongoose.model('IntegrationConnection');

const PROVIDER = 'gtm';
const RETURN_PATH = '/dev/integrations/gtm';

function traceEnvironment(env = process.env) {
  const issues = [];
  if (!env.GOOGLE_CLIENT_ID?.trim()) issues.push('GOOGLE_CLIENT_ID missing');
  if (!env.GOOGLE_CLIENT_SECRET?.trim()) issues.push('GOOGLE_CLIENT_SECRET missing');
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) issues.push('JWT_SECRET missing or too short');
  if (!env.TOKEN_ENCRYPTION_KEY?.trim()) issues.push('TOKEN_ENCRYPTION_KEY missing');
  if (env.GTM_API_ENABLED !== 'true') issues.push('GTM_API_ENABLED is not true');

  return stage('Environment', issues.length === 0, {
    id: 'environment',
    detail: issues.length ? issues.join('; ') : 'Required env vars present',
    data: {
      gtmApiEnabled: env.GTM_API_ENABLED === 'true',
      gtmApiMock: env.GTM_API_MOCK === 'true',
      oauthRedirectUri: getOAuthRedirectUri(),
      requiredScopes: allScopesForProvider(PROVIDER),
    },
    hint:
      issues.length > 0
        ? 'Fix backend/.env and restart the API before OAuth or API tests.'
        : undefined,
  });
}

/**
 * @param {string} businessId
 */
async function traceListGtmAccounts(businessId) {
  const conn = await IntegrationConnection.findOne({ businessId, provider: PROVIDER })
    .select('+accessTokenEnc')
    .lean();

  if (!conn?.accessTokenEnc) {
    return stage('List GTM accounts', false, {
      id: 'list_gtm_accounts',
      detail: 'Skipped — no stored access token',
      skipped: true,
    });
  }

  try {
    const accessToken = await getFreshGoogleAccessToken({ businessId, provider: PROVIDER });
    const accounts = await listGtmAccounts(accessToken);
    return stage('List GTM accounts', true, {
      id: 'list_gtm_accounts',
      detail: `Found ${accounts.length} GTM account(s)`,
      data: {
        accountCount: accounts.length,
        accounts: accounts.slice(0, 10).map((row) => ({
          accountId: row.accountId != null ? String(row.accountId) : null,
          name: row.name ?? null,
        })),
      },
      hint:
        accounts.length === 0
          ? 'OAuth succeeded but no GTM accounts — create one in tagmanager.google.com or provision.'
          : 'Select account, container, and workspace below before read/write tests.',
    });
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : 'GTM_LIST_FAILED';
    return stage('List GTM accounts', false, {
      id: 'list_gtm_accounts',
      detail: `${code}: ${err instanceof Error ? err.message : 'listGtmAccounts failed'}`,
      hint: 'Check OAuth scopes include tagmanager.manage.accounts and edit.containers.',
    });
  }
}

/**
 * @param {string} businessId
 * @param {string} userId
 */
async function runOAuthTrace(businessId, userId) {
  const stages = [];
  let connectUrl = null;

  stages.push(traceEnvironment());
  stages.push(traceTokenCrypto());

  const bcStage = await traceBusinessContext(businessId);
  stages.push(bcStage);
  if (!bcStage.ok) {
    return buildOAuthTraceReport({ businessId, userId, stages, connectUrl }, PROVIDER, RETURN_PATH);
  }

  const resolvedUserId = userId || String(bcStage.data?.userId || '');
  const connectStage = await traceConnectUrl(businessId, resolvedUserId, PROVIDER, RETURN_PATH);
  connectUrl = connectStage._connectUrl ?? null;
  const { _connectUrl, ...connectPublic } = connectStage;
  stages.push(connectPublic);

  stages.push(
    await traceStoredConnection(businessId, PROVIDER, (conn) => ({
      discoveryReason: conn.providerIdentifiers?.discoveryReason ?? null,
      selectedAccountId: conn.providerIdentifiers?.accountId ?? null,
      selectedContainerId: conn.providerIdentifiers?.containerId ?? null,
      selectedWorkspaceId: conn.providerIdentifiers?.workspaceId ?? null,
    })),
  );
  stages.push(await traceConnectionStatus(businessId, PROVIDER));
  stages.push(await traceTokenRefresh(businessId, PROVIDER));
  stages.push(await traceListGtmAccounts(businessId));

  return buildOAuthTraceReport({ businessId, userId: resolvedUserId, stages, connectUrl }, PROVIDER, RETURN_PATH);
}

/**
 * @param {object} params
 */
async function runGtmApiStep(params) {
  const { stepId, kind, accessToken, urlPath, method = 'GET', body, formatSuccessDetail } = params;

  try {
    const data =
      method === 'POST'
        ? await gtmPost(accessToken, urlPath, body)
        : await gtmGet(accessToken, urlPath);

    const detail =
      typeof formatSuccessDetail === 'function'
        ? formatSuccessDetail(data)
        : `${kind} succeeded`;

    return stage(stepId, true, {
      id: stepId,
      label: stepId,
      detail,
      data: {
        kind,
        urlPath,
        ...(typeof params.enrichSuccessData === 'function' ? params.enrichSuccessData(data) : {}),
      },
    });
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : 'GTM_API_FAILED';
    return stage(stepId, false, {
      id: stepId,
      label: stepId,
      detail: `${code}: ${err instanceof Error ? err.message : String(err)}`,
      data: { kind, urlPath },
      hint:
        code === 'GTM_API_NOT_ENABLED'
          ? 'Set GTM_API_ENABLED=true in backend/.env.'
          : 'OAuth user needs edit access on the selected workspace.',
    });
  }
}

/**
 * @param {string} businessId
 * @param {{ accountId?: string, containerId?: string, workspaceId?: string }} [options]
 */
function resolveGtmIds(businessId, options, conn) {
  const ids = conn?.providerIdentifiers ?? {};
  const accountId = String(options.accountId ?? ids.accountId ?? '').trim();
  const containerId = String(options.containerId ?? ids.containerId ?? '').trim();
  const workspaceId = String(options.workspaceId ?? ids.workspaceId ?? '').trim();
  return { accountId, containerId, workspaceId };
}

/**
 * @param {string} businessId
 * @param {{
 *   accountId?: string,
 *   containerId?: string,
 *   workspaceId?: string,
 *   mode?: 'read' | 'write' | 'all',
 * }} [options]
 */
async function runReadWriteTests(businessId, options = {}) {
  const startedAt = new Date().toISOString();
  const stages = [];
  const suffix = crypto.randomUUID().slice(0, 8);
  const mode = options.mode === 'read' || options.mode === 'write' ? options.mode : 'all';
  const runRead = mode === 'read' || mode === 'all';
  const runWrite = mode === 'write' || mode === 'all';

  stages.push(traceEnvironment());
  stages.push(
    await traceStoredConnection(businessId, PROVIDER, (conn) => ({
      selectedAccountId: conn.providerIdentifiers?.accountId ?? null,
      selectedContainerId: conn.providerIdentifiers?.containerId ?? null,
      selectedWorkspaceId: conn.providerIdentifiers?.workspaceId ?? null,
    })),
  );

  const conn = await IntegrationConnection.findOne({ businessId, provider: PROVIDER })
    .select('+accessTokenEnc providerIdentifiers')
    .lean();

  if (!conn?.accessTokenEnc) {
    return finalizeStagedReport({
      provider: PROVIDER,
      businessId,
      startedAt,
      stages,
      message: 'Connect GTM OAuth for this businessId before read/write tests.',
      ok: false,
      extra: { mode, workspaceReady: false, gtmIds: null },
    });
  }

  let accessToken;
  try {
    accessToken = await getFreshGoogleAccessToken({ businessId, provider: PROVIDER });
    stages.push(
      stage('Token refresh', true, {
        id: 'token_refresh',
        detail: 'Access token ready for GTM API calls',
      }),
    );
  } catch (err) {
    const refreshStage = stage('Token refresh', false, {
      id: 'token_refresh',
      detail: err instanceof Error ? err.message : 'Token refresh failed',
    });
    stages.push(refreshStage);
    return finalizeStagedReport({
      provider: PROVIDER,
      businessId,
      startedAt,
      stages,
      message: refreshStage.detail,
      ok: false,
      extra: { mode, workspaceReady: false, gtmIds: null },
    });
  }

  const gtmIds = resolveGtmIds(businessId, options, conn);
  if (!gtmIds.accountId || !gtmIds.containerId || !gtmIds.workspaceId) {
    const missingStage = stage('Resolve GTM workspace', false, {
      id: 'resolve_gtm_workspace',
      detail: 'accountId, containerId, and workspaceId are required',
      hint: 'Select GTM account, container, and workspace on this page (or save selection on dev integrations).',
    });
    stages.push(missingStage);
    return finalizeStagedReport({
      provider: PROVIDER,
      businessId,
      startedAt,
      stages,
      message: missingStage.detail,
      ok: false,
      extra: { mode, workspaceReady: false, gtmIds: null },
    });
  }

  stages.push(
    stage('Resolve GTM workspace', true, {
      id: 'resolve_gtm_workspace',
      detail: `Using workspace ${gtmIds.workspaceId} (${mode} tests)`,
      data: { ...gtmIds, mode },
    }),
  );

  let workspaceReady = false;
  try {
    const workspaces = await listGtmWorkspaces(accessToken, gtmIds.accountId, gtmIds.containerId);
    workspaceReady = workspaces.some((w) => String(w.workspaceId) === gtmIds.workspaceId);
    stages.push(
      stage('Check workspace access', workspaceReady, {
        id: 'check_workspace_access',
        detail: workspaceReady
          ? `Workspace ${gtmIds.workspaceId} is accessible`
          : `Workspace ${gtmIds.workspaceId} not found in container ${gtmIds.containerId}`,
        data: { workspaceReady, workspaceCount: workspaces.length },
        hint: workspaceReady ? undefined : 'Pick a workspace from the dropdown after OAuth trace.',
      }),
    );
  } catch (err) {
    stages.push(
      stage('Check workspace access', false, {
        id: 'check_workspace_access',
        detail: err instanceof Error ? err.message : 'Failed to verify workspace access',
      }),
    );
    return finalizeStagedReport({
      provider: PROVIDER,
      businessId,
      startedAt,
      stages,
      message: 'Could not verify GTM workspace access.',
      ok: false,
      extra: { mode, workspaceReady: false, gtmIds },
    });
  }

  if (!workspaceReady) {
    return finalizeStagedReport({
      provider: PROVIDER,
      businessId,
      startedAt,
      stages,
      message: 'Select an accessible GTM workspace before read/write tests.',
      ok: false,
      extra: { mode, workspaceReady: false, gtmIds },
    });
  }

  const base = workspaceBasePath(gtmIds);

  if (runRead) {
    stages.push(
      await runGtmApiStep({
        stepId: 'read_gtm_accounts',
        kind: 'read',
        accessToken,
        urlPath: 'accounts',
        enrichSuccessData: (data) => ({
          accountCount: Array.isArray(data?.account) ? data.account.length : 0,
        }),
        formatSuccessDetail: (data) =>
          `Found ${Array.isArray(data?.account) ? data.account.length : 0} account(s)`,
      }),
    );

    stages.push(
      await runGtmApiStep({
        stepId: 'read_gtm_containers',
        kind: 'read',
        accessToken,
        urlPath: `accounts/${gtmIds.accountId}/containers`,
        enrichSuccessData: (data) => ({
          containerCount: Array.isArray(data?.container) ? data.container.length : 0,
        }),
        formatSuccessDetail: (data) =>
          `Found ${Array.isArray(data?.container) ? data.container.length : 0} container(s)`,
      }),
    );

    stages.push(
      await runGtmApiStep({
        stepId: 'read_gtm_workspaces',
        kind: 'read',
        accessToken,
        urlPath: `accounts/${gtmIds.accountId}/containers/${gtmIds.containerId}/workspaces`,
        enrichSuccessData: (data) => ({
          workspaceCount: Array.isArray(data?.workspace) ? data.workspace.length : 0,
        }),
        formatSuccessDetail: (data) =>
          `Found ${Array.isArray(data?.workspace) ? data.workspace.length : 0} workspace(s)`,
      }),
    );

    stages.push(
      await runGtmApiStep({
        stepId: 'read_gtm_tags',
        kind: 'read',
        accessToken,
        urlPath: `${base}/tags`,
        enrichSuccessData: (data) => ({
          tagCount: Array.isArray(data?.tag) ? data.tag.length : 0,
          tags: (Array.isArray(data?.tag) ? data.tag : []).slice(0, 10).map((row) => ({
            name: row.name ?? null,
            type: row.type ?? null,
          })),
        }),
        formatSuccessDetail: (data) =>
          `Found ${Array.isArray(data?.tag) ? data.tag.length : 0} tag(s)`,
      }),
    );

    stages.push(
      await runGtmApiStep({
        stepId: 'read_gtm_triggers',
        kind: 'read',
        accessToken,
        urlPath: `${base}/triggers`,
        enrichSuccessData: (data) => ({
          triggerCount: Array.isArray(data?.trigger) ? data.trigger.length : 0,
        }),
        formatSuccessDetail: (data) =>
          `Found ${Array.isArray(data?.trigger) ? data.trigger.length : 0} trigger(s)`,
      }),
    );

    stages.push(
      await runGtmApiStep({
        stepId: 'read_gtm_variables',
        kind: 'read',
        accessToken,
        urlPath: `${base}/variables`,
        enrichSuccessData: (data) => ({
          variableCount: Array.isArray(data?.variable) ? data.variable.length : 0,
        }),
        formatSuccessDetail: (data) =>
          `Found ${Array.isArray(data?.variable) ? data.variable.length : 0} variable(s)`,
      }),
    );
  }

  if (runWrite) {
    try {
      const created = await createGtmWorkspaceResource({
        gtmIds,
        accessToken,
        collection: 'variables',
        logicalKey: `oauth-lab-${suffix}`,
        payload: {
          name: `ZUG_OAUTH_LAB_CONST_${suffix}`,
          type: 'c',
          parameter: [{ type: 'template', key: 'value', value: 'zuggernaut-oauth-lab' }],
        },
      });
      stages.push(
        stage('write_constant_variable', true, {
          id: 'write_constant_variable',
          label: 'write_constant_variable',
          detail: `Created constant variable (${created.resourcePath})`,
          data: {
            kind: 'write',
            resourcePath: created.resourcePath,
            source: created.source,
          },
        }),
      );
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : 'GTM_WRITE_FAILED';
      stages.push(
        stage('write_constant_variable', false, {
          id: 'write_constant_variable',
          label: 'write_constant_variable',
          detail: `${code}: ${err instanceof Error ? err.message : String(err)}`,
          hint: 'OAuth user needs edit permission on the workspace.',
        }),
      );
    }
  }

  return finalizeStagedReport({
    provider: PROVIDER,
    businessId,
    startedAt,
    stages,
    message:
      mode === 'read'
        ? 'GTM read test run completed.'
        : mode === 'write'
          ? 'GTM write test run completed.'
          : 'GTM read/write test run completed.',
    extra: { mode, workspaceReady: true, gtmIds },
  });
}

module.exports = {
  PROVIDER,
  RETURN_PATH,
  runOAuthTrace,
  runReadWriteTests,
};
