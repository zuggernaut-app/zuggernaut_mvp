const mongoose = require('mongoose');
const { SETUP_RUN_STATUS } = require('../constants/enums');

/**
 * One row per orchestrated setup attempt; durable summary for API/dashboard (Temporal holds execution).
 * `status` values align with Phase 3 “Initial workflow states”.
 * @see mvp_implementation_plan.md → Database Architecture Strategy (`SetupRun`), Phase 3.
 */
const setupRunSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    /** Correlates Mongo row with Temporal workflow id-string */
    temporalWorkflowId: { type: String, index: true, sparse: true },
    status: {
      type: String,
      enum: SETUP_RUN_STATUS,
      default: 'USER_INPUT_COLLECTED',
      index: true,
    },
    lastErrorSummary: { type: String },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

setupRunSchema.index({ businessId: 1, updatedAt: -1 });

module.exports = mongoose.model('SetupRun', setupRunSchema);
