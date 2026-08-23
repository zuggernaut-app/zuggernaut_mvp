'use strict';

const mongoose = require('mongoose');
const { DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER } = require('../../constants/provisioning');
const { gtmProvisioningIdempotencyKey } = require('../../constants/idempotency');
const {
  listGtmAccounts,
  createGtmContainer,
  resolveOrCreateWorkspace,
  getGtmAccessToken,
  GtmApiError,
} = require('../integrations/googleTagManagerClient');
const { hasRequiredIdentifiers } = require('../integrations/providerDiscoveryResult');
const { maybeInjectFailure } = require('../../lib/qaFailureInjection');

const IntegrationConnection = mongoose.model('IntegrationConnection');
const IntegrationArtifact = mongoose.model('IntegrationArtifact');
const IntegrationProvisioningRequest = mongoose.model('IntegrationProvisioningRequest');

class GtmProvisioningError extends Error {
  constructor(message, code = 'GTM_PROVISIONING_ERROR') {
    super(message);
    this.name = 'GtmProvisioningError';
    this.code = code;
  }
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {import('mongoose').Types.ObjectId | string} setupRunId
 * @param {'account' | 'container' | 'workspace'} resource
 */
function provisioningArtifactIdempotencyKey(businessId, setupRunId, resource) {
  return gtmProvisioningIdempotencyKey(businessId, setupRunId, resource);
}

/**
 * @param {object} ctx
 */
async function findProvisioningArtifact(ctx) {
  const { businessId, setupRunId, resource } = ctx;
  return IntegrationArtifact.findOne({
    businessId,
    setupRunId,
    provider: 'gtm',
    idempotencyKey: provisioningArtifactIdempotencyKey(businessId, setupRunId, resource),
  }).lean();
}

/**
 * @param {object} ctx
 */
async function persistProvisioningArtifact(ctx) {
  const { businessId, setupRunId, artifactType, resource, externalId, metadata } = ctx;
  await IntegrationArtifact.findOneAndUpdate(
    {
      businessId,
      setupRunId,
      provider: 'gtm',
      artifactType,
      externalId,
    },
    {
      $setOnInsert: {
        idempotencyKey: provisioningArtifactIdempotencyKey(businessId, setupRunId, resource),
      },
      $set: { metadata },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

/**
 * @param {object} request
 */
function assertApprovedGtmProvisioningRequest(request) {
  if (!request) {
    throw new GtmProvisioningError('GTM provisioning request not found.', 'GTM_PROVISIONING_REQUEST_NOT_FOUND');
  }
  if (request.provider !== 'gtm') {
    throw new GtmProvisioningError('Provisioning request is not for GTM.', 'GTM_PROVISIONING_INVALID_PROVIDER');
  }
  if (request.status !== 'approved') {
    throw new GtmProvisioningError(
      'GTM provisioning requires an approved consent request.',
      'GTM_PROVISIONING_APPROVAL_REQUIRED'
    );
  }
  if (!request.approvedByUserId || !request.approvedAt) {
    throw new GtmProvisioningError(
      'GTM provisioning approval audit fields are missing.',
      'GTM_PROVISIONING_APPROVAL_REQUIRED'
    );
  }

  const required = DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER.gtm;
  const missing = required.filter((r) => !request.requestedResources.includes(r));
  if (missing.length > 0) {
    throw new GtmProvisioningError(
      `GTM provisioning request missing resources: ${missing.join(', ')}`,
      'GTM_PROVISIONING_INVALID_REQUEST'
    );
  }
}

/**
 * Idempotent GTM container/workspace provisioning after explicit user approval.
 * GTM accounts must already exist — the Tag Manager API does not support account creation.
 *
 * @param {object} input
 * @param {import('mongoose').Types.ObjectId | string} input.businessId
 * @param {import('mongoose').Types.ObjectId | string} input.setupRunId
 * @param {import('mongoose').Types.ObjectId | string} input.provisioningRequestId
 * @param {string} [input.accountName]
 * @param {string} [input.containerName]
 * @param {import('pino').Logger} [input.logger]
 */
async function provisionGtmResources(input) {
  const {
    businessId,
    setupRunId,
    provisioningRequestId,
    accountName = 'Zuggernaut GTM',
    containerName = 'Zuggernaut Web',
    logger,
  } = input;

  maybeInjectFailure('gtm_provisioning');

  const request = await IntegrationProvisioningRequest.findById(provisioningRequestId);
  assertApprovedGtmProvisioningRequest(request);

  if (String(request.businessId) !== String(businessId)) {
    throw new GtmProvisioningError('Provisioning request business mismatch.', 'GTM_PROVISIONING_BUSINESS_MISMATCH');
  }

  await IntegrationProvisioningRequest.findByIdAndUpdate(provisioningRequestId, {
    $set: { status: 'provisioning', lastAttemptedAt: new Date(), setupRunId },
  });

  try {
    const accessToken = await getGtmAccessToken({ businessId });

    let accountId;
    const accountArtifact = await findProvisioningArtifact({ businessId, setupRunId, resource: 'account' });
    if (accountArtifact) {
      accountId = accountArtifact.externalId;
      logger?.info?.({ businessId: String(businessId), setupRunId: String(setupRunId), accountId }, 'gtm account artifact reused');
    } else {
      const conn = await IntegrationConnection.findOne({ businessId, provider: 'gtm' })
        .select('providerIdentifiers')
        .lean();
      const selectedAccountId = conn?.providerIdentifiers?.accountId
        ? String(conn.providerIdentifiers.accountId)
        : null;

      const accounts = await listGtmAccounts(accessToken);
      const selectable = accounts.filter((row) => row.accountId);

      if (selectedAccountId) {
        const match = selectable.find((row) => String(row.accountId) === selectedAccountId);
        if (!match) {
          throw new GtmProvisioningError(
            'Selected GTM account is no longer accessible for this OAuth grant.',
            'GTM_SELECTION_NOT_ACCESSIBLE'
          );
        }
        accountId = selectedAccountId;
        await persistProvisioningArtifact({
          businessId,
          setupRunId,
          artifactType: 'gtm_account',
          resource: 'account',
          externalId: accountId,
          metadata: match,
        });
        logger?.info?.({ businessId: String(businessId), setupRunId: String(setupRunId), accountId }, 'gtm account linked from saved selection');
      } else if (selectable.length === 1) {
        const account = selectable[0];
        accountId = String(account.accountId);
        await persistProvisioningArtifact({
          businessId,
          setupRunId,
          artifactType: 'gtm_account',
          resource: 'account',
          externalId: accountId,
          metadata: account,
        });
        logger?.info?.({ businessId: String(businessId), setupRunId: String(setupRunId), accountId }, 'gtm account auto-linked (single account)');
      } else if (selectable.length > 1) {
        throw new GtmProvisioningError(
          'Multiple GTM accounts are available. Select one before provisioning.',
          'GTM_SELECTION_REQUIRED'
        );
      } else {
        throw new GtmProvisioningError(
          'No GTM account available. Create a GTM account at https://tagmanager.google.com, refresh integrations, then approve provisioning again.',
          'GTM_ACCOUNT_NOT_FOUND'
        );
      }
    }

    let containerId;
    let publicContainerId;
    const containerArtifact = await findProvisioningArtifact({ businessId, setupRunId, resource: 'container' });
    if (containerArtifact) {
      containerId = containerArtifact.externalId;
      publicContainerId = containerArtifact.metadata?.publicContainerId ?? null;
      logger?.info?.({ businessId: String(businessId), setupRunId: String(setupRunId), containerId }, 'gtm container artifact reused');
    } else {
      const priorContainer = await IntegrationArtifact.findOne({
        businessId,
        provider: 'gtm',
        artifactType: 'gtm_container',
        'metadata.role': { $ne: 'container_version' },
        'metadata.path': { $regex: `^accounts/${accountId}/` },
      })
        .sort({ createdAt: -1 })
        .lean();

      if (priorContainer?.externalId) {
        containerId = String(priorContainer.externalId);
        publicContainerId = priorContainer.metadata?.publicContainerId ?? null;
        logger?.info?.(
          { businessId: String(businessId), setupRunId: String(setupRunId), containerId },
          'gtm container reused from prior integration artifact'
        );
      } else {
        const container = await createGtmContainer(accessToken, accountId, {
          name: containerName,
          usageContext: ['web'],
        });
        containerId = container.containerId;
        publicContainerId = container.publicContainerId ?? null;
        await persistProvisioningArtifact({
          businessId,
          setupRunId,
          artifactType: 'gtm_container',
          resource: 'container',
          externalId: containerId,
          metadata: container,
        });
        logger?.info?.(
          { businessId: String(businessId), setupRunId: String(setupRunId), containerId },
          'gtm container provisioned'
        );
      }
    }

    let workspaceId;
    const workspaceArtifact = await findProvisioningArtifact({ businessId, setupRunId, resource: 'workspace' });
    if (workspaceArtifact) {
      workspaceId = workspaceArtifact.externalId;
      logger?.info?.({ businessId: String(businessId), setupRunId: String(setupRunId), workspaceId }, 'gtm workspace artifact reused');
    } else {
      const workspace = await resolveOrCreateWorkspace(accessToken, accountId, containerId);
      workspaceId = workspace.workspaceId;
      await persistProvisioningArtifact({
        businessId,
        setupRunId,
        artifactType: 'gtm_workspace',
        resource: 'workspace',
        externalId: workspaceId,
        metadata: workspace,
      });
      logger?.info?.({ businessId: String(businessId), setupRunId: String(setupRunId), workspaceId }, 'gtm workspace provisioned');
    }

    const providerIdentifiers = {
      accountId,
      containerId,
      workspaceId,
      ...(publicContainerId ? { publicContainerId } : {}),
    };

    if (!hasRequiredIdentifiers('gtm', providerIdentifiers)) {
      throw new GtmProvisioningError(
        'GTM provisioning completed without required identifiers.',
        'GTM_PROVISIONING_INCOMPLETE'
      );
    }

    await IntegrationConnection.findOneAndUpdate(
      { businessId, provider: 'gtm' },
      {
        $set: {
          connectionHealth: 'connected',
          providerIdentifiers,
        },
      }
    );

    await IntegrationProvisioningRequest.findByIdAndUpdate(provisioningRequestId, {
      $set: {
        status: 'provisioned',
        createdProviderIdentifiers: providerIdentifiers,
        errorCode: null,
        errorMessage: null,
        lastAttemptedAt: new Date(),
      },
    });

    return {
      providerIdentifiers,
      connectionHealth: 'connected',
    };
  } catch (err) {
    const errorCode =
      err instanceof GtmProvisioningError || err instanceof GtmApiError
        ? err.code
        : typeof err.code === 'string'
          ? err.code
          : 'GTM_PROVISIONING_FAILED';

    await IntegrationProvisioningRequest.findByIdAndUpdate(provisioningRequestId, {
      $set: {
        status: 'failed',
        errorCode,
        errorMessage: err.message,
        lastAttemptedAt: new Date(),
      },
    });

    throw err;
  }
}

module.exports = {
  GtmProvisioningError,
  provisioningArtifactIdempotencyKey,
  provisionGtmResources,
};
