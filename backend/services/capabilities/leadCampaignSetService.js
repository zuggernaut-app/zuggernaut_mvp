'use strict';

const mongoose = require('mongoose');
const { LEAD_CAMPAIGN_SLOTS } = require('../../constants/leadCampaign');

const LeadCampaignSet = mongoose.model('LeadCampaignSet');

class LeadCampaignSetError extends Error {
  constructor(message, code = 'LEAD_CAMPAIGN_SET_ERROR') {
    super(message);
    this.name = 'LeadCampaignSetError';
    this.code = code;
  }
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function ensureLeadCampaignSet(businessId) {
  const biz =
    businessId instanceof mongoose.Types.ObjectId
      ? businessId
      : new mongoose.Types.ObjectId(businessId);
  let doc = await LeadCampaignSet.findOne({ businessId: biz });
  if (!doc) {
    try {
      doc = await LeadCampaignSet.create({ businessId: biz });
    } catch (err) {
      if (err?.code === 11000) {
        doc = await LeadCampaignSet.findOne({ businessId: biz });
      } else {
        throw err;
      }
    }
  }
  return doc;
}

/**
 * Atomically reserve a managed slot (one winner per slot).
 *
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {'recommended' | 'alternative'} slot
 * @param {object} slotData
 */
async function reserveSlot(businessId, slot, slotData) {
  if (!LEAD_CAMPAIGN_SLOTS.includes(slot)) {
    throw new LeadCampaignSetError(`Invalid slot: ${slot}`, 'validation_error');
  }

  await ensureLeadCampaignSet(businessId);

  const now = new Date();
  const update = {
    [`${slot}.slot`]: slot,
    [`${slot}.reservedAt`]: now,
    [`${slot}.reviewStatus`]: 'pending_review',
    [`${slot}.regenerationCount`]: 0,
    [`${slot}.desiredState`]: 'paused',
    [`${slot}.desiredStateVersion`]: 0,
    ...Object.fromEntries(
      Object.entries(slotData).map(([k, v]) => [`${slot}.${k}`, v])
    ),
  };

  const result = await LeadCampaignSet.findOneAndUpdate(
    {
      businessId,
      $or: [
        { [slot]: { $exists: false } },
        { [`${slot}.reservedAt`]: { $exists: false } },
        { [`${slot}.reservedAt`]: null },
      ],
    },
    { $set: update },
    { returnDocument: 'after' }
  );

  if (!result) {
    const existing = await LeadCampaignSet.findOne({ businessId }).lean();
    if (existing?.[slot]?.reservedAt) {
      return { reserved: false, idempotent: true, set: existing };
    }
    throw new LeadCampaignSetError(
      `Failed to reserve slot ${slot}.`,
      'LEAD_CAMPAIGN_SLOT_RESERVE_FAILED'
    );
  }

  return { reserved: true, idempotent: false, set: result };
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function getLeadCampaignSet(businessId) {
  return LeadCampaignSet.findOne({ businessId }).lean();
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {'recommended' | 'alternative'} slot
 * @param {object} patch
 * @param {number} [expectedVersion]
 */
async function updateSlot(businessId, slot, patch, expectedVersion, options = {}) {
  const filter = { businessId };
  if (expectedVersion !== undefined && expectedVersion !== null) {
    filter[`${slot}.desiredStateVersion`] = expectedVersion;
  }

  const setFields = Object.fromEntries(
    Object.entries(patch).map(([k, v]) => [`${slot}.${k}`, v])
  );

  const update = { $set: setFields };
  if (options.incrementVersion) {
    update.$inc = { [`${slot}.desiredStateVersion`]: 1 };
  }

  const doc = await LeadCampaignSet.findOneAndUpdate(filter, update, {
    returnDocument: 'after',
  });

  if (!doc) {
    throw new LeadCampaignSetError(
      'Slot version mismatch or set not found.',
      'LEAD_CAMPAIGN_VERSION_MISMATCH'
    );
  }
  return doc;
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {'recommended' | 'alternative'} slot
 */
async function bumpDesiredStateVersion(businessId, slot) {
  const doc = await LeadCampaignSet.findOneAndUpdate(
    { businessId },
    { $inc: { [`${slot}.desiredStateVersion`]: 1 } },
    { returnDocument: 'after' }
  );
  return doc?.[slot]?.desiredStateVersion ?? null;
}

module.exports = {
  LeadCampaignSetError,
  ensureLeadCampaignSet,
  reserveSlot,
  getLeadCampaignSet,
  updateSlot,
  bumpDesiredStateVersion,
};
