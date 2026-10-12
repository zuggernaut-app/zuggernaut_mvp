'use strict';

const mongoose = require('mongoose');
const { gtmStep1ContainerIdempotencyKey } = require('../../constants/idempotency');
const { createLogger } = require('../../lib/observability/logger');
const {
  createGtmContainer,
  resolveOrCreateWorkspace,
  getGtmAccessToken,
  GtmApiError,
} = require('../integrations/googleTagManagerClient');
const { hasRequiredIdentifiers } = require('../integrations/providerDiscoveryResult');
const {
  claimProviderResource,
  finalizeProviderResourceClaim,
  markProviderResourceClaimFailed,
  isCreatedProviderArtifact,
  ProviderResourceClaimError,
} = require('./providerResourceClaim');

const IntegrationConnection = mongoose.model('IntegrationConnection');

const logger = createLogger({ name: 'businessSetupGtmContainer' });

class BusinessSetupGtmContainerError extends Error {
  constructor(message, code = 'GTM_BUSINESS_SETUP_CONTAINER_ERROR') {
    super(message);
    this.name = 'BusinessSetupGtmContainerError';
    this.code = code;
  }
}

const CONTAINER_NAME = 'Zuggernaut Web';

/**
 * @param {object} input
 * @param {import('mongoose').Types.ObjectId | string} input.businessId
 */
async function createGtmContainerForBusinessSetup(input) {
  const { businessId } = input;

  const conn = await IntegrationConnection.findOne({ businessId, provider: 'gtm' })
    .select('providerIdentifiers connectionHealth')
    .lean();
  const accountId = conn?.providerIdentifiers?.accountId
    ? String(conn.providerIdentifiers.accountId)
    : null;
  if (!accountId) {
    throw new BusinessSetupGtmContainerError(
      'Connect Tag Manager and select an account before creating a container.',
      'GTM_ACCOUNT_REQUIRED'
    );
  }

  const existingContainerId = conn?.providerIdentifiers?.containerId
    ? String(conn.providerIdentifiers.containerId)
    : null;
  const existingPublicId = conn?.providerIdentifiers?.publicContainerId ?? null;
  if (existingContainerId && existingPublicId && conn?.connectionHealth === 'connected') {
    return {
      containerId: existingContainerId,
      publicContainerId: existingPublicId,
      idempotent: true,
    };
  }

  const idempotencyKey = gtmStep1ContainerIdempotencyKey(businessId);
  let claim;
  try {
    claim = await claimProviderResource({
      businessId,
      provider: 'gtm',
      artifactType: 'gtm_container',
      idempotencyKey,
      pendingExternalId: `pending:gtm-container:${businessId}`,
      claimMetadata: { accountId, source: 'business_setup_step1', containerName: CONTAINER_NAME },
    });
  } catch (err) {
    if (err instanceof ProviderResourceClaimError && err.code === 'PROVIDER_RESOURCE_CLAIM_IN_PROGRESS') {
      throw new BusinessSetupGtmContainerError(
        'Tag Manager container creation is already in progress. Try again shortly.',
        err.code
      );
    }
    throw err;
  }

  if (!claim.claimed && isCreatedProviderArtifact(claim.artifact)) {
    const containerId = String(claim.artifact.externalId);
    const publicContainerId = claim.artifact.metadata?.publicContainerId ?? null;
    const workspaceId = claim.artifact.metadata?.workspaceId ?? null;
    if (containerId && workspaceId) {
      await persistGtmConnection(businessId, accountId, {
        containerId,
        publicContainerId,
        workspaceId,
        containerName: claim.artifact.metadata?.name ?? CONTAINER_NAME,
      });
      return { containerId, publicContainerId, idempotent: true };
    }
  }

  const accessToken = await getGtmAccessToken({ businessId });

  try {
    const container = await createGtmContainer(accessToken, accountId, {
      name: CONTAINER_NAME,
      usageContext: ['web'],
    });
    const workspace = await resolveOrCreateWorkspace(accessToken, accountId, container.containerId);

    await finalizeProviderResourceClaim({
      idempotencyKey,
      externalId: container.containerId,
      metadataPatch: {
        ...container,
        accountId,
        workspaceId: workspace.workspaceId,
        publicContainerId: container.publicContainerId ?? null,
      },
    });

    await persistGtmConnection(businessId, accountId, {
      containerId: container.containerId,
      publicContainerId: container.publicContainerId ?? null,
      workspaceId: workspace.workspaceId,
      containerName: container.name ?? CONTAINER_NAME,
      workspaceName: workspace.name ?? null,
    });

    logger.info(
      {
        businessId: String(businessId),
        accountId,
        containerId: container.containerId,
        stepName: 'business_setup_accounts',
        provider: 'gtm',
      },
      'gtm container created from business setup step 1'
    );

    return {
      containerId: container.containerId,
      publicContainerId: container.publicContainerId ?? null,
      idempotent: false,
    };
  } catch (err) {
    await markProviderResourceClaimFailed({
      idempotencyKey,
      errorCode: err?.code ?? 'GTM_CONTAINER_CREATE_FAILED',
      errorMessage: err instanceof Error ? err.message : 'create failed',
    });
    if (err instanceof GtmApiError) {
      throw new BusinessSetupGtmContainerError(err.message, err.code);
    }
    throw err;
  }
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {string} accountId
 * @param {object} ids
 */
async function persistGtmConnection(businessId, accountId, ids) {
  const providerIdentifiers = {
    accountId,
    containerId: ids.containerId,
    workspaceId: ids.workspaceId,
    ...(ids.publicContainerId ? { publicContainerId: ids.publicContainerId } : {}),
    ...(ids.containerName ? { containerName: ids.containerName } : {}),
    ...(ids.workspaceName ? { workspaceName: ids.workspaceName } : {}),
  };

  if (!hasRequiredIdentifiers('gtm', providerIdentifiers)) {
    throw new BusinessSetupGtmContainerError(
      'GTM container setup completed without required identifiers.',
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
}

module.exports = {
  BusinessSetupGtmContainerError,
  createGtmContainerForBusinessSetup,
};
