const mongoose = require('mongoose');

/**
 * Canonical confirmed business inputs; never overwrite from scrape without user confirmation.
 * Tenant key is `businessId` (stable across integrations and referenced by other collections).
 * @see mvp_implementation_plan.md → Database Architecture Strategy (`BusinessContext`).
 *
 * @typedef {object} ConversionStrategy
 * @property {'calls'|'forms'|'both'} resolvedPrimaryGoal
 * @property {ConversionSlotRequirement[]} requiredSlots
 * @property {'scrape_goals'|'user_confirmed_goals'|'default'} derivedFrom
 * @property {string} derivedAt — ISO timestamp
 *
 * @typedef {object} ConversionSlotRequirement
 * @property {string} slot — 'call' | 'form'
 * @property {string} logicalCategory
 * @property {boolean} required
 * @property {'existing'|'create'|'pending'} resolution — filled later by the manage step
 * @property {string|null} externalId — filled when resolved
 * @property {string|null} resourceName — filled when resolved
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
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Org', index: true },
    websiteUrl: { type: String, trim: true },
    businessName: { type: String, trim: true },
    industry: { type: String, trim: true },
    services: [{ type: String, trim: true }],
    serviceAreas: [{ type: String, trim: true }],
    contactMethods: { type: mongoose.Schema.Types.Mixed, default: undefined },
    audienceSignals: { type: mongoose.Schema.Types.Mixed, default: undefined },
    goals: { type: mongoose.Schema.Types.Mixed, default: undefined },
    /** Derived conversion strategy — populated by goal-to-ads mapping, never by user directly. */
    conversionStrategy: { type: mongoose.Schema.Types.Mixed, default: undefined },
    differentiators: { type: String, trim: true },
    orderValueHint: { type: String, trim: true },
    /** User-confirmed thank-you / confirmation page URL path(s) for GTM form conversion triggers. */
    thankYouUrls: [{ type: String, trim: true }],
    /** Frozen slug5-id6 key set at first context confirm; used for deterministic Ads/GTM resource names. */
    nameKey: { type: String, trim: true },
    /** Raw scrape output — never map into confirmed fields without explicit user save */
    rawScrapeOutput: { type: mongoose.Schema.Types.Mixed, select: false },
    confirmedAt: { type: Date },
  },
  { timestamps: true }
);

businessContextSchema.index({ userId: 1, updatedAt: -1 });

module.exports = mongoose.model('BusinessContext', businessContextSchema);
