const mongoose = require('mongoose');
const { SCRAPE_RUN_STATUS } = require('../constants/enums');

/**
 * One row per async website scrape (Temporal). Mirrors SetupRun pattern: API/dashboard status,
 * workflow id for correlation. Raw crawl payload is appended to BusinessContext.rawScrapeOutput.runs.
 */
const scrapeRunSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      /** Who triggered the scrape; used for GET authorization. */
      required: true,
      index: true,
    },
    websiteUrl: { type: String, trim: true, required: true },
    temporalWorkflowId: { type: String, index: true, sparse: true },
    status: {
      type: String,
      enum: SCRAPE_RUN_STATUS,
      default: 'QUEUED',
      index: true,
    },
    lastErrorSummary: { type: String },
    /** When raw scrape blob was written to BusinessContext (idempotency). */
    persistedAt: { type: Date },
    /** Copy of suggested fields for polling before client reads BusinessContext. */
    resultSuggested: { type: mongoose.Schema.Types.Mixed },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

scrapeRunSchema.index({ businessId: 1, updatedAt: -1 });

module.exports = mongoose.model('ScrapeRun', scrapeRunSchema);
