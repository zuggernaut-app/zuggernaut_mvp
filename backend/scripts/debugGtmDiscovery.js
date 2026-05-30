/**
 * Manual diagnostic: discover GTM accounts/containers/workspaces for a business.
 *
 * Uses the stored GTM IntegrationConnection and existing token refresh flow.
 * Calls the real Google Tag Manager API and logs only safe fields.
 *
 * Run from backend/:
 *   node scripts/debugGtmDiscovery.js <businessId>
 *
 * Example:
 *   node scripts/debugGtmDiscovery.js 6a182b25ed74f1aca1cb08c0
 *
 * Requires: MONGODB_URI, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY
 * Optional: GOOGLE_OAUTH_MOCK=false (must be false or unset for real API calls)
 */
'use strict';

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const axios = require('axios');
const mongoose = require('mongoose');
const { IntegrationConnection } = require('../models');
const { getFreshGoogleAccessToken } = require('../services/integrations/googleTokenService');

const GTM_API_BASE = 'https://tagmanager.googleapis.com/tagmanager/v2';
const PROVIDER = 'gtm';

const uri =
  process.env.MONGODB_URI ||
  process.env.mongodb_uri ||
  'mongodb://localhost:27017/zuggernaut';

function usage() {
  console.error('Usage: node scripts/debugGtmDiscovery.js <businessId>');
  process.exit(1);
}

function logSection(title) {
  console.log(`\n=== ${title} ===`);
}

function safeAccountSummary(account) {
  return {
    accountId: account.accountId ?? null,
    name: account.name ?? null,
    path: account.path ?? null,
  };
}

function safeContainerSummary(container) {
  return {
    containerId: container.containerId ?? null,
    publicId: container.publicId ?? null,
    name: container.name ?? null,
    usageContext: container.usageContext ?? null,
    path: container.path ?? null,
  };
}

function safeWorkspaceSummary(workspace) {
  return {
    workspaceId: workspace.workspaceId ?? null,
    name: workspace.name ?? null,
    path: workspace.path ?? null,
  };
}

function safeApiError(err, res) {
  if (res) {
    return {
      httpStatus: res.status,
      error: typeof res.data?.error?.message === 'string' ? res.data.error.message : null,
      errorStatus: res.data?.error?.status ?? null,
      errorReason: res.data?.error?.errors?.[0]?.reason ?? null,
    };
  }
  return {
    message: err?.message ?? String(err),
    code: err?.code ?? null,
  };
}

/**
 * @param {string} accessToken
 * @param {string} urlPath - path after /tagmanager/v2/
 */
async function gtmGet(accessToken, urlPath) {
  const url = `${GTM_API_BASE}/${urlPath.replace(/^\/+/, '')}`;
  const res = await axios.get(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    timeout: 30000,
    validateStatus: () => true,
  });
  return res;
}

async function discoverGtmHierarchy(accessToken) {
  const accountsRes = await gtmGet(accessToken, 'accounts');

  if (accountsRes.status < 200 || accountsRes.status >= 300) {
    return {
      ok: false,
      stage: 'accounts',
      error: safeApiError(null, accountsRes),
      accounts: [],
    };
  }

  const rawAccounts = accountsRes.data?.account ?? [];
  const accounts = [];

  for (const account of rawAccounts) {
    const accountId = account.accountId;
    const accountEntry = {
      ...safeAccountSummary(account),
      containers: [],
    };

    if (!accountId) {
      accounts.push(accountEntry);
      continue;
    }

    const containersRes = await gtmGet(accessToken, `accounts/${accountId}/containers`);

    if (containersRes.status < 200 || containersRes.status >= 300) {
      accountEntry.containersError = safeApiError(null, containersRes);
      accounts.push(accountEntry);
      continue;
    }

    const rawContainers = containersRes.data?.container ?? [];

    for (const container of rawContainers) {
      const containerId = container.containerId;
      const containerEntry = {
        ...safeContainerSummary(container),
        workspaces: [],
      };

      if (!containerId) {
        accountEntry.containers.push(containerEntry);
        continue;
      }

      const workspacesRes = await gtmGet(
        accessToken,
        `accounts/${accountId}/containers/${containerId}/workspaces`
      );

      if (workspacesRes.status < 200 || workspacesRes.status >= 300) {
        containerEntry.workspacesError = safeApiError(null, workspacesRes);
        accountEntry.containers.push(containerEntry);
        continue;
      }

      const rawWorkspaces = workspacesRes.data?.workspace ?? [];
      containerEntry.workspaces = rawWorkspaces.map(safeWorkspaceSummary);
      accountEntry.containers.push(containerEntry);
    }

    accounts.push(accountEntry);
  }

  return { ok: true, stage: 'complete', accounts };
}

function diagnose({ connection, discovery }) {
  const lines = [];

  if (process.env.GOOGLE_OAUTH_MOCK === 'true') {
    lines.push('GOOGLE_OAUTH_MOCK=true — token refresh returns mock tokens; use real mode for API diagnosis.');
  }

  if (!connection) {
    lines.push('No GTM IntegrationConnection found for this businessId.');
    lines.push('Next step: connect GTM from the setup page first.');
    return lines;
  }

  if (connection.connectionHealth !== 'connected') {
    lines.push(`GTM connection health is "${connection.connectionHealth}" (expected "connected").`);
    lines.push('Next step: reconnect GTM or fix token/auth issues.');
  }

  const ids = connection.providerIdentifiers ?? {};
  const hasStoredIds = Boolean(ids.accountId && ids.containerId && ids.workspaceId);
  if (hasStoredIds) {
    lines.push('Stored providerIdentifiers look complete (accountId, containerId, workspaceId present).');
  } else {
    lines.push('Stored providerIdentifiers are missing or incomplete.');
    lines.push(`  accountId: ${ids.accountId ?? '(missing)'}`);
    lines.push(`  containerId: ${ids.containerId ?? '(missing)'}`);
    lines.push(`  workspaceId: ${ids.workspaceId ?? '(missing)'}`);
    lines.push('  publicContainerId: ' + (ids.publicContainerId ?? '(missing)'));
  }

  if (!discovery.ok) {
    lines.push(`GTM API failed at stage "${discovery.stage}".`);
    lines.push(`  HTTP ${discovery.error.httpStatus ?? 'n/a'}: ${discovery.error.error ?? discovery.error.message ?? 'unknown'}`);
    if (discovery.error.httpStatus === 403) {
      lines.push('Likely cause: missing scopes or account lacks GTM access. Revoke app access and reconnect GTM.');
    } else if (discovery.error.httpStatus === 401) {
      lines.push('Likely cause: invalid or expired token. Reconnect GTM.');
    }
    return lines;
  }

  const accountCount = discovery.accounts.length;
  const containerCount = discovery.accounts.reduce((n, a) => n + a.containers.length, 0);
  const workspaceCount = discovery.accounts.reduce(
    (n, a) => n + a.containers.reduce((m, c) => m + c.workspaces.length, 0),
    0
  );

  lines.push(`GTM API reachable: ${accountCount} account(s), ${containerCount} container(s), ${workspaceCount} workspace(s).`);

  if (accountCount === 0) {
    lines.push('No GTM accounts returned for this Google user.');
    lines.push('Likely cause: user has no GTM account yet, or was never granted access to one.');
    lines.push('Next step: create a GTM account at https://tagmanager.google.com/ or get invited to an existing account, then reconnect GTM.');
  } else if (containerCount === 0) {
    lines.push('GTM account(s) exist but no containers found.');
    lines.push('Next step: create a web container in GTM, then reconnect GTM.');
  } else if (workspaceCount === 0) {
    lines.push('Containers exist but no workspaces found (unusual — each container should have a default workspace).');
  } else if (!hasStoredIds) {
    lines.push('GTM resources exist in Google but were not persisted on IntegrationConnection.');
    lines.push('Likely cause: fetchProviderIdentifiers is not implemented for real mode yet.');
    lines.push('Next step: implement identifier discovery and reconnect GTM, or backfill providerIdentifiers.');
  } else {
    lines.push('GTM discovery looks healthy.');
  }

  return lines;
}

async function main() {
  const businessIdArg = process.argv[2];
  if (!businessIdArg) usage();

  if (!mongoose.Types.ObjectId.isValid(businessIdArg)) {
    console.error('Invalid businessId (must be a MongoDB ObjectId hex string).');
    process.exit(1);
  }

  logSection('Config (safe fields only)');
  console.log({
    businessId: businessIdArg,
    provider: PROVIDER,
    googleOAuthMock: process.env.GOOGLE_OAUTH_MOCK === 'true',
    gtmApiEnabled: process.env.GTM_API_ENABLED === 'true',
    mongoUriHost: (() => {
      try {
        return new URL(uri.replace(/^mongodb(\+srv)?:\/\//, 'https://')).hostname;
      } catch {
        return '(unknown)';
      }
    })(),
  });

  await mongoose.connect(uri);

  const connection = await IntegrationConnection.findOne({
    businessId: businessIdArg,
    provider: PROVIDER,
  })
    .select('businessId provider connectionHealth scopes tokenExpiryAt providerIdentifiers updatedAt')
    .lean()
    .exec();

  logSection('IntegrationConnection (safe fields only)');
  if (!connection) {
    console.log('(not found)');
  } else {
    console.log({
      businessId: String(connection.businessId),
      provider: connection.provider,
      connectionHealth: connection.connectionHealth,
      scopes: connection.scopes ?? [],
      tokenExpiryAt: connection.tokenExpiryAt?.toISOString?.() ?? null,
      providerIdentifiers: connection.providerIdentifiers ?? null,
      updatedAt: connection.updatedAt?.toISOString?.() ?? null,
    });
  }

  if (!connection) {
    logSection('Diagnosis');
    diagnose({ connection: null, discovery: { ok: false, stage: 'connection' } }).forEach((line) =>
      console.log(line)
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  if (connection.connectionHealth !== 'connected') {
    logSection('Diagnosis');
    diagnose({ connection, discovery: { ok: false, stage: 'connection_health' } }).forEach((line) =>
      console.log(line)
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  logSection('Token refresh');
  let accessToken;
  try {
    accessToken = await getFreshGoogleAccessToken({ businessId: businessIdArg, provider: PROVIDER });
    console.log('Access token obtained (value not logged).');
  } catch (err) {
    console.log(safeApiError(err));
    logSection('Diagnosis');
    console.log('Could not obtain a fresh access token.');
    console.log(`  ${err.code ?? 'ERROR'}: ${err.message}`);
    console.log('Next step: reconnect GTM from the setup page.');
    await mongoose.disconnect();
    process.exit(1);
  }

  logSection('GTM API discovery');
  let discovery;
  try {
    discovery = await discoverGtmHierarchy(accessToken);
  } catch (err) {
    discovery = { ok: false, stage: 'network', error: safeApiError(err), accounts: [] };
  }

  if (!discovery.ok) {
    console.log(JSON.stringify({ stage: discovery.stage, error: discovery.error }, null, 2));
  } else {
    console.log(JSON.stringify({ accounts: discovery.accounts }, null, 2));
  }

  logSection('Diagnosis');
  diagnose({ connection, discovery }).forEach((line) => console.log(line));

  await mongoose.disconnect();
  process.exit(discovery.ok ? 0 : 1);
}

main().catch(async (err) => {
  console.error('Fatal:', err.message);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
