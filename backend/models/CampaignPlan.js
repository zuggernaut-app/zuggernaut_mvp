const mongoose = require('mongoose');
const { CAMPAIGN_PLAN_STATUS } = require('../constants/enums');

/**
 * Deterministic Google Ads intent before creation; deployed ids live on `IntegrationArtifact`.
 * @see mvp_implementation_plan.md → Database Architecture Strategy (`CampaignPlan`), Phase 10.
 */
const campaignPlanSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    setupRunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SetupRun',
      required: true,
    },
    status: {
      type: String,
      enum: CAMPAIGN_PLAN_STATUS,
      default: 'draft',
      index: true,
    },
    /** Deterministic Ads structure before API calls — shape evolves with AdsAutoCampaignService */
    intent: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  { timestamps: true }
);

campaignPlanSchema.index({ setupRunId: 1 }, { unique: true });

module.exports = mongoose.model('CampaignPlan', campaignPlanSchema);
