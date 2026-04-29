const mongoose = require('mongoose');

/**
 * Canonical confirmed business inputs; never overwrite from scrape without user confirmation.
 * Tenant key is `businessId` (stable across integrations and referenced by other collections).
 * @see mvp_implementation_plan.md → Database Architecture Strategy (`BusinessContext`).
 */
const businessContextSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
      default: () => new mongoose.Types.ObjectId(),
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    websiteUrl: { type: String, trim: true },
    businessName: { type: String, trim: true },
    industry: { type: String, trim: true },
    services: [{ type: String, trim: true }],
    serviceAreas: [{ type: String, trim: true }],
    contactMethods: { type: mongoose.Schema.Types.Mixed, default: undefined },
    audienceSignals: { type: mongoose.Schema.Types.Mixed, default: undefined },
    goals: { type: mongoose.Schema.Types.Mixed, default: undefined },
    differentiators: { type: String, trim: true },
    orderValueHint: { type: String, trim: true },
    /** Raw scrape output — never map into confirmed fields without explicit user save */
    rawScrapeOutput: { type: mongoose.Schema.Types.Mixed, select: false },
    confirmedAt: { type: Date },
  },
  { timestamps: true }
);

businessContextSchema.index({ userId: 1, updatedAt: -1 });

module.exports = mongoose.model('BusinessContext', businessContextSchema);
