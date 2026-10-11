'use strict';

const mongoose = require('mongoose');
const { createLogger } = require('../../lib/observability/logger');
const { LEAD_CAMPAIGN_SLOTS } = require('../../constants/leadCampaign');
const { pauseAdsCampaign } = require('../integrations/googleAdsCampaignClient');
const { getLeadCampaignSet, updateSlot } = require('./leadCampaignSetService');
const { createLeadCampaignsForSetupRun } = require('./leadCampaignCreationService');
const { requireSetupReadyConnection } = require('./setupReadyConnectionService');
const { AdsProviderPreconditionError } = require('./adsAutoCampaignService');

const BusinessContext = mongoose.model('BusinessContext');
const SetupRun = mongoose.model('SetupRun');
const IntegrationArtifact = mongoose.model('IntegrationArtifact');

const FACT_REBUILD_LEASE_MS = 5 * 60 * 1000;
const logger = createLogger({ name: 'leadCampaignFactRebuildService' });

class LeadCampaignFactRebuildError extends Error {
  constructor(message, code = 'LEAD_CAMPAIGN_FACT_REBUILD_ERROR') {
    super(message);
    this.name = 'LeadCampaignFactRebuildError';
    this.code = code;
  }
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {'recommended' | 'alternative'} slot
 */
async function claimFactRebuild(businessId, slot) {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + FACT_REBUILD_LEASE_MS);
  const bc = await BusinessContext.findOne({ businessId }).lean();
  const latest = bc?.latestFactVersion ?? 0;

  const claimed = await mongoose.model('LeadCampaignSet').findOneAndUpdate(
    {
      businessId,
      [`${slot}.reservedAt`]: { $ne: null },
      [`${slot}.desiredState`]: { $ne: 'enabled' },
      $and: [
        {
          $or: [
            { [`${slot}.builtFactVersion`]: { $exists: false } },
            { [`${slot}.builtFactVersion`]: { $lt: latest } },
          ],
        },
        {
          $or: [
            { [`${slot}.factRebuildClaimState`]: { $exists: false } },
            { [`${slot}.factRebuildClaimState`]: 'failed' },
            { [`${slot}.factRebuildClaimState`]: null },
            { [`${slot}.factRebuildClaimLeaseExpiresAt`]: { $lte: now } },
          ],
        },
      ],
    },
    {
      $set: {
        [`${slot}.factRebuildClaimState`]: 'claiming',
        [`${slot}.factRebuildClaimLeaseExpiresAt`]: leaseUntil,
      },
    },
    { new: true }
  );

  if (!claimed) {
    return { claimed: false, latest };
  }
  return { claimed: true, latest, set: claimed };
}

/**
 * Recreate a paused slot in Google Ads from latest facts (pauses prior campaign).
 *
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {'recommended' | 'alternative'} slot
 */
async function rebuildLeadCampaignSlotFromLatestFacts(businessId, slot) {
  if (!LEAD_CAMPAIGN_SLOTS.includes(slot)) {
    throw new LeadCampaignFactRebuildError('Invalid slot.', 'validation_error');
  }

  const claim = await claimFactRebuild(businessId, slot);
  if (!claim.claimed) {
    return { rebuilt: false, idempotent: true };
  }

  const set = await getLeadCampaignSet(businessId);
  const slotDoc = set?.[slot];
  const campaignRn = slotDoc?.providerResourceNames?.campaign;
  if (campaignRn) {
    await pauseAdsCampaign({ businessId, campaignResourceName: String(campaignRn) });
  }

  const setupRun = await SetupRun.findOne({ businessId }).sort({ updatedAt: -1 }).lean();
  if (!setupRun) {
    await updateSlot(businessId, slot, { factRebuildClaimState: 'failed' });
    throw new LeadCampaignFactRebuildError('No setup run for business.', 'not_found');
  }

  const bc = await BusinessContext.findOne({ businessId }).select('+rawScrapeOutput').lean();
  if (!bc) {
    await updateSlot(businessId, slot, { factRebuildClaimState: 'failed' });
    throw new LeadCampaignFactRebuildError('Business not found.', 'not_found');
  }

  let customerId;
  try {
    ({ customerId } = await requireSetupReadyConnection(
      businessId,
      'google_ads',
      AdsProviderPreconditionError
    ));
  } catch (err) {
    await updateSlot(businessId, slot, { factRebuildClaimState: 'failed' });
    throw err;
  }

  const conversionArtifacts = await IntegrationArtifact.find({
    businessId,
    setupRunId: setupRun._id,
    provider: 'google_ads',
    artifactType: { $in: ['ads_conversion_action', 'ads_conversion_action_created'] },
  }).lean();

  try {
    await createLeadCampaignsForSetupRun({
      setupRunId: setupRun._id,
      businessId,
      customerId,
      bc,
      conversionArtifacts,
      logger,
      onlySlot: slot,
    });
  } catch (err) {
    await updateSlot(businessId, slot, { factRebuildClaimState: 'failed' });
    throw err;
  }

  await updateSlot(businessId, slot, {
    builtFactVersion: claim.latest,
    factRebuildClaimState: 'succeeded',
    reviewStatus: 'pending_review',
  });

  logger.info(
    { businessId: businessId.toString(), slot, provider: 'google_ads', factVersion: claim.latest },
    'lead campaign slot rebuilt from latest facts'
  );

  return { rebuilt: true, factVersion: claim.latest };
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {'recommended' | 'alternative'} slot
 */
async function ensureSlotBuiltFromLatestFacts(businessId, slot) {
  const bc = await BusinessContext.findOne({ businessId }).select('latestFactVersion').lean();
  const latest = bc?.latestFactVersion ?? 0;
  const set = await getLeadCampaignSet(businessId);
  const built = set?.[slot]?.builtFactVersion ?? 0;
  if (!set?.[slot]?.reservedAt || built >= latest) {
    return { rebuilt: false };
  }
  return rebuildLeadCampaignSlotFromLatestFacts(businessId, slot);
}

module.exports = {
  LeadCampaignFactRebuildError,
  ensureSlotBuiltFromLatestFacts,
  rebuildLeadCampaignSlotFromLatestFacts,
};
