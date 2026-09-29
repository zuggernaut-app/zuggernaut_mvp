'use strict';

const mongoose = require('mongoose');
const { LEAD_CAMPAIGN_SLOTS } = require('../constants/leadCampaign');

const slotSchema = new mongoose.Schema(
  {
    slot: { type: String, enum: LEAD_CAMPAIGN_SLOTS, required: true },
    action: { type: String, enum: ['calls', 'forms'], trim: true },
    offer: { type: String, trim: true },
    places: [{ type: String, trim: true }],
    page: { type: String, trim: true },
    proofLine: { type: String, trim: true },
    reviewStatus: {
      type: String,
      enum: ['pending_review', 'approved', 'sent_back', 'internal_review', 'retired'],
      default: 'pending_review',
    },
    regenerationCount: { type: Number, default: 0 },
    completedRegenerations: { type: Number, default: 0 },
    disapprovalDedupeKeys: [{ type: String, trim: true }],
    reviewHistory: { type: mongoose.Schema.Types.Mixed, default: () => [] },
    trackingByAction: { type: mongoose.Schema.Types.Mixed, default: undefined },
    committedBudgetMicros: { type: Number },
    budgetConfirmedAt: { type: Date },
    desiredStateVersion: { type: Number, default: 0 },
    desiredState: { type: String, enum: ['paused', 'enabled'], default: 'paused' },
    pauseReason: { type: String, trim: true },
    pendingProviderChange: { type: mongoose.Schema.Types.Mixed, default: undefined },
    providerResourceNames: { type: mongoose.Schema.Types.Mixed, default: undefined },
    reservedAt: { type: Date },
  },
  { _id: false }
);

const leadCampaignSetSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },
    /** Task 41 — deduped operator alerts from read-only disapproval polling. */
    operatorNotifications: {
      type: [
        {
          type: { type: String, trim: true },
          slot: { type: String, trim: true },
          dedupeKey: { type: String, trim: true },
          policyTopic: { type: String, trim: true },
          adResourceName: { type: String, trim: true },
          createdAt: { type: Date },
        },
      ],
      default: undefined,
    },
    recommended: { type: slotSchema, default: undefined },
    alternative: { type: slotSchema, default: undefined },
  },
  { timestamps: true }
);

module.exports = mongoose.model('LeadCampaignSet', leadCampaignSetSchema);
