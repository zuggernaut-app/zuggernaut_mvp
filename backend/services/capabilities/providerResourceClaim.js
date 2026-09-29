'use strict';

const mongoose = require('mongoose');
const { CONVERSION_ACTION_CLAIM_LEASE_MS } = require('../../constants/conversionActionClaim');

const IntegrationArtifact = mongoose.model('IntegrationArtifact');

class ProviderResourceClaimError extends Error {
  constructor(message, code = 'PROVIDER_RESOURCE_CLAIM_ERROR') {
    super(message);
    this.name = 'ProviderResourceClaimError';
    this.code = code;
  }
}

/**
 * @param {object} artifact
 */
function isCreatedProviderArtifact(artifact) {
  if (!artifact) return false;
  if (artifact.metadata?.claimState === 'created') return true;
  const externalId = String(artifact.externalId ?? '');
  return (
    !externalId.startsWith('pending:') &&
    artifact.metadata?.claimState !== 'claiming' &&
    artifact.metadata?.claimState !== 'failed'
  );
}

/**
 * Atomically claim a provider resource slot by business-scoped idempotencyKey.
 *
 * @param {object} ctx
 * @returns {Promise<{ claimed: boolean, artifact: object | null, idempotent?: boolean }>}
 */
async function claimProviderResource(ctx) {
  const {
    setupRunId,
    businessId,
    provider,
    artifactType,
    idempotencyKey,
    pendingExternalId,
    claimMetadata = {},
    leaseMs = CONVERSION_ACTION_CLAIM_LEASE_MS,
  } = ctx;

  const now = new Date();
  const leaseUntil = new Date(now.getTime() + leaseMs);

  const existing = await IntegrationArtifact.findOne({ idempotencyKey }).lean();
  if (isCreatedProviderArtifact(existing)) {
    return { claimed: false, artifact: existing, idempotent: true };
  }

  if (existing?.metadata?.claimState === 'claiming') {
    const leaseExpired =
      !existing.metadata?.claimLeaseExpiresAt ||
      new Date(existing.metadata.claimLeaseExpiresAt) <= now;
    if (!leaseExpired) {
      throw new ProviderResourceClaimError(
        'Provider resource creation is already in progress.',
        'PROVIDER_RESOURCE_CLAIM_IN_PROGRESS'
      );
    }
  }

  const metadata = {
    ...claimMetadata,
    claimState: 'claiming',
    claimLeaseExpiresAt: leaseUntil.toISOString(),
  };

  let artifact;
  try {
    artifact = await IntegrationArtifact.findOneAndUpdate(
      {
        idempotencyKey,
        $or: [
          { metadata: { $exists: false } },
          { 'metadata.claimState': 'failed' },
          {
            'metadata.claimState': 'claiming',
            'metadata.claimLeaseExpiresAt': { $lte: now.toISOString() },
          },
        ],
      },
      {
        $setOnInsert: {
          setupRunId,
          businessId,
          provider,
          artifactType,
          idempotencyKey,
        },
        $set: {
          externalId: pendingExternalId,
          metadata,
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    ).lean();
  } catch (err) {
    if (err?.code === 11000) {
      const latest = await IntegrationArtifact.findOne({ idempotencyKey }).lean();
      if (isCreatedProviderArtifact(latest)) {
        return { claimed: false, artifact: latest, idempotent: true };
      }
      throw new ProviderResourceClaimError(
        'Provider resource creation is already in progress.',
        'PROVIDER_RESOURCE_CLAIM_IN_PROGRESS'
      );
    }
    throw err;
  }

  if (!artifact || artifact.metadata?.claimState !== 'claiming') {
    const latest = await IntegrationArtifact.findOne({ idempotencyKey }).lean();
    if (isCreatedProviderArtifact(latest)) {
      return { claimed: false, artifact: latest, idempotent: true };
    }
    throw new ProviderResourceClaimError(
      'Failed to claim provider resource slot.',
      'PROVIDER_RESOURCE_CLAIM_FAILED'
    );
  }

  return { claimed: true, artifact };
}

/**
 * @param {object} ctx
 */
async function finalizeProviderResourceClaim(ctx) {
  const { idempotencyKey, externalId, metadataPatch = {} } = ctx;
  await IntegrationArtifact.findOneAndUpdate(
    { idempotencyKey, 'metadata.claimState': 'claiming' },
    {
      $set: {
        externalId,
        metadata: {
          ...metadataPatch,
          claimState: 'created',
        },
      },
    }
  );
}

/**
 * @param {object} ctx
 */
async function markProviderResourceClaimFailed(ctx) {
  const { idempotencyKey, errorCode, errorMessage, metadataPatch = {} } = ctx;
  await IntegrationArtifact.findOneAndUpdate(
    { idempotencyKey, 'metadata.claimState': 'claiming' },
    {
      $set: {
        metadata: {
          ...metadataPatch,
          claimState: 'failed',
          errorCode: errorCode ?? 'PROVIDER_RESOURCE_CREATE_FAILED',
          errorMessage: errorMessage ?? 'provider resource creation failed',
        },
      },
    }
  );
}

module.exports = {
  ProviderResourceClaimError,
  claimProviderResource,
  finalizeProviderResourceClaim,
  markProviderResourceClaimFailed,
  isCreatedProviderArtifact,
};
