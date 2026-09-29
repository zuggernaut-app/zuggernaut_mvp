'use strict';

const mongoose = require('mongoose');
const { createLogger } = require('../../lib/observability/logger');
const { businessScopedIdempotencyKey } = require('../../constants/idempotency');
const {
  createResponsiveSearchAd,
  pauseAdsCampaign,
} = require('../integrations/googleAdsCampaignClient');
const { GoogleAdsApiError } = require('../integrations/googleAdsConversionCatalogClient');
const { requireSetupReadyConnection } = require('./setupReadyConnectionService');
const { getLeadCampaignSet, updateSlot } = require('./leadCampaignSetService');
const {
  claimProviderResource,
  finalizeProviderResourceClaim,
  markProviderResourceClaimFailed,
  isCreatedProviderArtifact,
} = require('./providerResourceClaim');
const { persistAdsArtifact } = require('./adsAutoCampaignService');

const IntegrationArtifact = mongoose.model('IntegrationArtifact');
const CampaignPlan = mongoose.model('CampaignPlan');

const logger = createLogger({ name: 'leadCampaignRegenerationService' });

class LeadCampaignRegenerationError extends Error {
  constructor(message, code = 'LEAD_CAMPAIGN_REGENERATION_ERROR') {
    super(message);
    this.name = 'LeadCampaignRegenerationError';
    this.code = code;
  }
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {'recommended' | 'alternative'} slot
 */
async function loadSlotAdGroupArtifact(businessId, slot) {
  const artifact = await IntegrationArtifact.findOne({
    businessId,
    provider: 'google_ads',
    artifactType: 'ads_ad_group',
    'metadata.slot': slot,
  })
    .sort({ updatedAt: -1 })
    .lean();

  if (!artifact?.externalId) {
    throw new LeadCampaignRegenerationError(
      `No ad group artifact found for slot ${slot}.`,
      'ADS_AD_GROUP_NOT_FOUND'
    );
  }
  return artifact;
}

/**
 * Persist regeneration step before each provider mutation (crash-safe resume).
 *
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {string} slot
 * @param {number} regenerationNumber
 * @param {string} step
 */
async function persistRegenerationStep(businessId, slot, regenerationNumber, step) {
  await updateSlot(businessId, slot, {
    pendingProviderChange: {
      type: 'regenerate',
      regenerationNumber,
      step,
      updatedAt: new Date().toISOString(),
    },
  });
}

/**
 * Task 28 — regenerate RSA ad for a sent-back slot with per-regeneration claims.
 *
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {'recommended' | 'alternative'} slot
 * @param {import('pino').Logger} [parentLogger]
 */
async function regenerateCampaignSlotAd(businessId, slot, parentLogger = logger) {
  const set = await getLeadCampaignSet(businessId);
  const slotDoc = set?.[slot];
  if (!slotDoc?.reservedAt) {
    throw new LeadCampaignRegenerationError('Slot not found.', 'not_found');
  }
  if (slotDoc.reviewStatus !== 'sent_back') {
    throw new LeadCampaignRegenerationError(
      'Regeneration requires review status sent_back.',
      'invalid_review_state'
    );
  }

  const completedRegenerations = slotDoc.completedRegenerations ?? 0;
  if (completedRegenerations >= 2) {
    throw new LeadCampaignRegenerationError(
      'Maximum regenerations reached for this slot.',
      'regeneration_limit_reached'
    );
  }
  const regenerationNumber = slotDoc.regenerationCount ?? 1;
  const scopedKey = `${slot}:ad:regen:${regenerationNumber}`;
  const fingerprint = `regen-${regenerationNumber}`;

  const existingAd = await IntegrationArtifact.findOne({
    businessId,
    provider: 'google_ads',
    artifactType: 'ads_ad',
    idempotencyKey: businessScopedIdempotencyKey(businessId, 'google_ads', scopedKey, fingerprint),
  }).lean();

  if (existingAd?.externalId && !String(existingAd.externalId).startsWith('pending:')) {
    await updateSlot(businessId, slot, {
      reviewStatus: 'pending_review',
      pendingProviderChange: undefined,
      providerResourceNames: {
        ...(slotDoc.providerResourceNames ?? {}),
        ad: existingAd.externalId,
      },
    });
    return { idempotent: true, adResourceName: existingAd.externalId, slot, regenerationNumber };
  }

  const adGroupArtifact = await loadSlotAdGroupArtifact(businessId, slot);
  const setupRunId = adGroupArtifact.setupRunId;
  const plan = await CampaignPlan.findOne({ setupRunId, slot, status: 'applied' }).lean();
  if (!plan?.intent?.ad) {
    throw new LeadCampaignRegenerationError('Campaign plan intent missing for slot.', 'ADS_PLAN_NOT_FOUND');
  }

  const { customerId } = await requireSetupReadyConnection(
    businessId,
    'google_ads',
    LeadCampaignRegenerationError
  );

  await persistRegenerationStep(businessId, slot, regenerationNumber, 'claim_ad');

  const idempotencyKey = businessScopedIdempotencyKey(businessId, 'google_ads', scopedKey, fingerprint);
  const claim = await claimProviderResource({
    setupRunId,
    businessId,
    provider: 'google_ads',
    artifactType: 'ads_ad',
    idempotencyKey,
    pendingExternalId: `pending:${idempotencyKey}`,
    claimMetadata: { logicalKey: scopedKey, slot, regenerationNumber, fingerprint },
  });

  if (!claim.claimed && isCreatedProviderArtifact(claim.artifact)) {
    await updateSlot(businessId, slot, {
      reviewStatus: 'pending_review',
      pendingProviderChange: undefined,
      providerResourceNames: {
        ...(slotDoc.providerResourceNames ?? {}),
        ad: claim.artifact.externalId,
      },
    });
    return { idempotent: true, adResourceName: claim.artifact.externalId, slot, regenerationNumber };
  }

  const priorAdResourceName = slotDoc.providerResourceNames?.ad;
  if (priorAdResourceName) {
    const campaignArtifact = await IntegrationArtifact.findOne({
      businessId,
      provider: 'google_ads',
      artifactType: 'ads_campaign',
      'metadata.slot': slot,
    }).lean();
    if (campaignArtifact?.externalId) {
      await pauseAdsCampaign({
        businessId,
        campaignResourceName: campaignArtifact.externalId,
      });
    }
  }

  await persistRegenerationStep(businessId, slot, regenerationNumber, 'create_ad');

  const clientCtx = {
    businessId,
    customerId,
    setupRunId: setupRunId.toString(),
    intent: plan.intent,
    adGroupResourceName: adGroupArtifact.externalId,
    regenerationNumber,
    slot,
  };

  let created;
  try {
    created = await createResponsiveSearchAd(clientCtx);
    await finalizeProviderResourceClaim({
      idempotencyKey,
      externalId: created.resourceName,
      metadataPatch: { logicalKey: scopedKey, slot, regenerationNumber },
    });
  } catch (err) {
    await markProviderResourceClaimFailed({
      idempotencyKey,
      errorCode: err instanceof GoogleAdsApiError ? err.code : 'GOOGLE_ADS_MUTATE_FAILED',
      errorMessage: err instanceof Error ? err.message : 'ad regeneration failed',
    });
    throw err;
  }

  await persistRegenerationStep(businessId, slot, regenerationNumber, 'finalize');

  await persistAdsArtifact({
    setupRunId,
    businessId,
    artifactType: 'ads_ad',
    logicalKey: scopedKey,
    externalId: created.resourceName,
    intentFingerprint: fingerprint,
    crossRunReuseBlocked: true,
    metadata: {
      slot,
      regenerationNumber,
      adGroupResourceName: adGroupArtifact.externalId,
      finalUrl: plan.intent.ad.finalUrl,
      source: created.source,
    },
  });

  await updateSlot(businessId, slot, {
    reviewStatus: 'pending_review',
    pendingProviderChange: undefined,
    completedRegenerations: completedRegenerations + 1,
    providerResourceNames: {
      ...(slotDoc.providerResourceNames ?? {}),
      ad: created.resourceName,
      priorAd: priorAdResourceName ?? slotDoc.providerResourceNames?.priorAd ?? null,
    },
  });

  parentLogger.info(
    {
      businessId: businessId.toString(),
      slot,
      regenerationNumber,
      adResourceName: created.resourceName,
      provider: 'google_ads',
    },
    'lead campaign ad regenerated'
  );

  return {
    idempotent: false,
    adResourceName: created.resourceName,
    slot,
    regenerationNumber,
    source: created.source,
  };
}

module.exports = {
  LeadCampaignRegenerationError,
  regenerateCampaignSlotAd,
};
