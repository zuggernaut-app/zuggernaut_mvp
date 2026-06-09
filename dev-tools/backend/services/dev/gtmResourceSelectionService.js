'use strict';

const { mongoose } = require('../../shared');
const {
  listGtmAccounts,
  listGtmContainers,
  listGtmWorkspaces,
  normalizeGtmAccount,
  normalizeGtmContainer,
  normalizeGtmWorkspace,
} = require('../../../../backend/services/integrations/googleTagManagerClient');
const { getFreshGoogleAccessToken } = require('../../../../backend/services/integrations/googleTokenService');
const { getOAuthConnectionStatus } = require('../../../../backend/services/capabilities/integrationConnectionService');
const { selectionTimestampFields } = require('../../lib/dev/providerResourceSelection');
const { SELECTION_SOURCE } = require('../../constants/providerResourceSelection');
const { recordProviderResourceSelection } = require('../../lib/dev/recordProviderResourceSelection');

const IntegrationConnection = mongoose.model('IntegrationConnection');

class GtmResourceSelectionError extends Error {
  /**
   * @param {string} message
   * @param {string} [code]
   */
  constructor(message, code = 'GTM_RESOURCE_SELECTION_ERROR') {
    super(message);
    this.name = 'GtmResourceSelectionError';
    this.code = code;
  }
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function requireGtmOAuth(businessId) {
  const oauth = await getOAuthConnectionStatus(businessId, 'gtm', { attemptRefresh: true });
  if (!oauth.oauthReady) {
    throw new GtmResourceSelectionError(
      'Connect GTM before listing selectable resources.',
      'GTM_NOT_CONNECTED'
    );
  }
  return oauth;
}

/**
 * @param {string} accessToken
 */
async function buildGtmResourceTree(accessToken) {
  const accounts = await listGtmAccounts(accessToken);
  const tree = [];

  for (const rawAccount of accounts) {
    const account = normalizeGtmAccount(rawAccount);
    if (!account) continue;

    const rawContainers = await listGtmContainers(accessToken, account.accountId);
    const containers = [];

    for (const rawContainer of rawContainers) {
      const container = normalizeGtmContainer(rawContainer);
      if (!container) continue;

      const rawWorkspaces = await listGtmWorkspaces(
        accessToken,
        account.accountId,
        container.containerId
      );
      const workspaces = rawWorkspaces
        .map((rawWorkspace) => normalizeGtmWorkspace(rawWorkspace))
        .filter(Boolean);

      if (workspaces.length === 0) continue;

      containers.push({
        ...container,
        workspaces,
      });
    }

    if (containers.length === 0) continue;

    tree.push({
      ...account,
      containers,
    });
  }

  return tree;
}

/**
 * @param {object[]} accounts
 */
function findGtmSelectionInTree(accounts, selection) {
  const account = accounts.find((row) => row.accountId === selection.accountId);
  if (!account) return null;

  const container = account.containers.find((row) => row.containerId === selection.containerId);
  if (!container) return null;

  const workspace = container.workspaces.find((row) => row.workspaceId === selection.workspaceId);
  if (!workspace) return null;

  return { account, container, workspace };
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function listGtmResourceOptions(businessId) {
  await requireGtmOAuth(businessId);

  const conn = await IntegrationConnection.findOne({ businessId, provider: 'gtm' })
    .select('connectionHealth providerIdentifiers')
    .lean();

  const accessToken = await getFreshGoogleAccessToken({ businessId, provider: 'gtm' });
  const accounts = await buildGtmResourceTree(accessToken);

  if (accounts.length === 0) {
    return {
      businessId: String(businessId),
      provider: 'gtm',
      selectionRequired: false,
      reason: 'GTM_PROVISIONING_REQUIRED',
      accounts: [],
      selected: null,
    };
  }

  const ids = conn?.providerIdentifiers ?? {};
  const selectedMatch =
    ids.accountId && ids.containerId && ids.workspaceId
      ? findGtmSelectionInTree(accounts, {
          accountId: String(ids.accountId),
          containerId: String(ids.containerId),
          workspaceId: String(ids.workspaceId),
        })
      : null;

  return {
    businessId: String(businessId),
    provider: 'gtm',
    selectionRequired: !selectedMatch,
    reason: selectedMatch ? null : 'GTM_RESOURCE_SELECTION_REQUIRED',
    accounts,
    selected: selectedMatch
      ? {
          accountId: selectedMatch.account.accountId,
          accountName: selectedMatch.account.name,
          containerId: selectedMatch.container.containerId,
          containerName: selectedMatch.container.name,
          publicContainerId: selectedMatch.container.publicContainerId,
          workspaceId: selectedMatch.workspace.workspaceId,
          workspaceName: selectedMatch.workspace.name,
          selectedAt: ids.selectedAt ?? null,
        }
      : null,
  };
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {{ accountId: string, containerId: string, workspaceId: string }} selection
 */
async function saveGtmSelection(businessId, selection) {
  await requireGtmOAuth(businessId);

  const accountId = selection.accountId?.trim();
  const containerId = selection.containerId?.trim();
  const workspaceId = selection.workspaceId?.trim();

  if (!accountId || !containerId || !workspaceId) {
    throw new GtmResourceSelectionError(
      'accountId, containerId, and workspaceId are required.',
      'GTM_SELECTION_INVALID'
    );
  }

  const accessToken = await getFreshGoogleAccessToken({ businessId, provider: 'gtm' });
  const accounts = await buildGtmResourceTree(accessToken);
  const match = findGtmSelectionInTree(accounts, { accountId, containerId, workspaceId });

  if (!match) {
    throw new GtmResourceSelectionError(
      'Selected GTM account/container/workspace is not accessible for this OAuth grant.',
      'GTM_SELECTION_NOT_ACCESSIBLE'
    );
  }

  const providerIdentifiers = {
    accountId: match.account.accountId,
    accountName: match.account.name,
    containerId: match.container.containerId,
    containerName: match.container.name,
    publicContainerId: match.container.publicContainerId,
    workspaceId: match.workspace.workspaceId,
    workspaceName: match.workspace.name,
    selectionRequired: false,
    ...selectionTimestampFields(SELECTION_SOURCE.DEV_INTEGRATIONS),
  };

  await recordProviderResourceSelection(businessId, 'gtm', providerIdentifiers, {
    source: SELECTION_SOURCE.DEV_INTEGRATIONS,
    summary: {
      accountId: providerIdentifiers.accountId,
      containerId: providerIdentifiers.containerId,
      workspaceId: providerIdentifiers.workspaceId,
      publicContainerId: providerIdentifiers.publicContainerId,
    },
  });

  return {
    businessId: String(businessId),
    provider: 'gtm',
    selectionRequired: false,
    selected: {
      accountId: providerIdentifiers.accountId,
      accountName: providerIdentifiers.accountName,
      containerId: providerIdentifiers.containerId,
      containerName: providerIdentifiers.containerName,
      publicContainerId: providerIdentifiers.publicContainerId,
      workspaceId: providerIdentifiers.workspaceId,
      workspaceName: providerIdentifiers.workspaceName,
      selectedAt: providerIdentifiers.selectedAt,
    },
    providerIdentifiers,
  };
}

module.exports = {
  GtmResourceSelectionError,
  listGtmResourceOptions,
  saveGtmSelection,
};
