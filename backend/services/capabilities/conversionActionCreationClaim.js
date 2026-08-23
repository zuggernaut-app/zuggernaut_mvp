'use strict';

const mongoose = require('mongoose');
const { CONVERSION_ACTION_CLAIM_LEASE_MS } = require('../../constants/conversionActionClaim');
const { DEFAULT_CONVERSION_ACTION_TEMPLATES } = require('../../constants/conversionActionRequirements');

const IntegrationArtifact = mongoose.model('IntegrationArtifact');

class ConversionActionClaimError extends Error {
  constructor(message, code = 'CONVERSION_ACTION_CLAIM_ERROR') {
    super(message);
    this.name = 'ConversionActionClaimError';
    this.code = code;
  }
}

/**
 * @param {object} artifact
 */
function isCreatedConversionArtifact(artifact) {
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
 * @param {object} ctx
 */
async function findCreatedConversionArtifact(ctx) {
  const { setupRunId, businessId, idempotencyKey } = ctx;
  const artifact = await IntegrationArtifact.findOne({
    setupRunId,
    businessId,
    provider: 'google_ads',
    idempotencyKey,
  }).lean();

  return isCreatedConversionArtifact(artifact) ? artifact : null;
}

/**
 * Atomically claim a conversion-action creation slot.
 *
 * @param {object} ctx
 * @returns {Promise<{ claimed: boolean, artifact: object | null, idempotent?: boolean }>}
 */
async function claimConversionActionCreation(ctx) {
  const { setupRunId, businessId, slot, idempotencyKey, template } = ctx;
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + CONVERSION_ACTION_CLAIM_LEASE_MS);
  const pendingExternalId = `pending:${slot.slot}`;

  const existing = await IntegrationArtifact.findOne({
    setupRunId,
    businessId,
    provider: 'google_ads',
    idempotencyKey,
  }).lean();

  if (isCreatedConversionArtifact(existing)) {
    return { claimed: false, artifact: existing, idempotent: true };
  }

  if (existing?.metadata?.claimState === 'claiming') {
    const leaseExpired =
      !existing.metadata?.claimLeaseExpiresAt ||
      new Date(existing.metadata.claimLeaseExpiresAt) <= now;
    if (!leaseExpired) {
      throw new ConversionActionClaimError(
        'Conversion action creation is already in progress for this slot.',
        'CONVERSION_ACTION_CLAIM_IN_PROGRESS'
      );
    }
  }

  const metadata = {
    slot: slot.slot,
    logicalCategory: slot.logicalCategory,
    claimState: 'claiming',
    claimLeaseExpiresAt: leaseUntil.toISOString(),
    template,
    ownedTemplateName: template?.name ?? null,
    source: null,
    resourceName: null,
  };

  let artifact;
  try {
    artifact = await IntegrationArtifact.findOneAndUpdate(
      {
        setupRunId,
        businessId,
        provider: 'google_ads',
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
        $setOnInsert: { idempotencyKey },
        $set: {
          artifactType: 'ads_conversion_action_created',
          externalId: pendingExternalId,
          metadata,
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    ).lean();
  } catch (err) {
    if (err?.code === 11000) {
      const latest = await IntegrationArtifact.findOne({
        setupRunId,
        businessId,
        provider: 'google_ads',
        idempotencyKey,
      }).lean();
      if (isCreatedConversionArtifact(latest)) {
        return { claimed: false, artifact: latest, idempotent: true };
      }
      throw new ConversionActionClaimError(
        'Conversion action creation is already in progress for this slot.',
        'CONVERSION_ACTION_CLAIM_IN_PROGRESS'
      );
    }
    throw err;
  }

  if (!artifact || artifact.metadata?.claimState !== 'claiming') {
    const latest = await IntegrationArtifact.findOne({
      setupRunId,
      businessId,
      provider: 'google_ads',
      idempotencyKey,
    }).lean();
    if (isCreatedConversionArtifact(latest)) {
      return { claimed: false, artifact: latest, idempotent: true };
    }
    throw new ConversionActionClaimError(
      'Failed to claim conversion action creation slot.',
      'CONVERSION_ACTION_CLAIM_FAILED'
    );
  }

  return { claimed: true, artifact };
}

/**
 * @param {object} ctx
 */
async function finalizeConversionActionCreation(ctx) {
  const { setupRunId, businessId, slot, externalId, resourceName, source, template, measurement } = ctx;
  const metadata = {
    slot: slot.slot,
    logicalCategory: slot.logicalCategory,
    claimState: 'created',
    resourceName,
    template,
    source,
    ...(measurement?.conversionId ? { conversionId: measurement.conversionId } : {}),
    ...(measurement?.conversionLabel ? { conversionLabel: measurement.conversionLabel } : {}),
    ...(measurement?.tagSnippets ? { tagSnippets: measurement.tagSnippets } : {}),
  };

  await IntegrationArtifact.findOneAndUpdate(
    {
      setupRunId,
      businessId,
      provider: 'google_ads',
      artifactType: 'ads_conversion_action_created',
      'metadata.slot': slot.slot,
    },
    {
      $set: {
        externalId,
        metadata,
      },
    }
  );
}

/**
 * @param {object} ctx
 */
async function markConversionActionCreationFailed(ctx) {
  const { setupRunId, businessId, slot, errorCode, errorMessage } = ctx;
  await IntegrationArtifact.findOneAndUpdate(
    {
      setupRunId,
      businessId,
      provider: 'google_ads',
      artifactType: 'ads_conversion_action_created',
      'metadata.slot': slot.slot,
      'metadata.claimState': 'claiming',
    },
    {
      $set: {
        metadata: {
          slot: slot.slot,
          logicalCategory: slot.logicalCategory,
          claimState: 'failed',
          errorCode: errorCode ?? 'CONVERSION_ACTION_CREATE_FAILED',
          errorMessage: errorMessage ?? 'conversion action creation failed',
        },
      },
    }
  );
}

/**
 * @param {Error} err
 */
function isOwnedNameRecoverableError(err) {
  const { GoogleAdsApiError } = require('../integrations/googleAdsApiConfig');
  if (!(err instanceof GoogleAdsApiError)) return false;

  const rows = err.details?.googleAdsErrors ?? [];
  return rows.some((row) => {
    const code = String(row.errorCode ?? '').toUpperCase();
    return (
      code.includes('DUPLICATE') ||
      code.includes('ALREADY_EXISTS') ||
      code.includes('NAME_NOT_UNIQUE')
    );
  });
}

/**
 * Recover a Zuggernaut-owned conversion action by deterministic template name.
 *
 * @param {object[]} catalogActions — normalized catalog rows with name/externalId/resourceName
 * @param {string} logicalCategory
 * @param {string | null | undefined} [ownedTemplateName]
 */
function recoverOwnedConversionAction(catalogActions, logicalCategory, ownedTemplateName) {
  const template = DEFAULT_CONVERSION_ACTION_TEMPLATES[logicalCategory];
  if (!template?.name) return null;

  const candidates = [
    typeof ownedTemplateName === 'string' && ownedTemplateName.trim()
      ? ownedTemplateName.trim()
      : null,
    template.name,
  ].filter(Boolean);

  for (const expectedName of candidates) {
    const owned = (catalogActions ?? []).filter(
      (action) => String(action.name ?? '').trim() === expectedName
    );
    if (owned.length === 1) return owned[0];
  }

  return null;
}

module.exports = {
  ConversionActionClaimError,
  claimConversionActionCreation,
  finalizeConversionActionCreation,
  markConversionActionCreationFailed,
  findCreatedConversionArtifact,
  recoverOwnedConversionAction,
  isOwnedNameRecoverableError,
  isCreatedConversionArtifact,
};
