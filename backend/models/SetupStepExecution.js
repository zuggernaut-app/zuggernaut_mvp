const mongoose = require('mongoose');
const { STEP_EXECUTION_STATUS, PROVIDERS } = require('../constants/enums');

/**
 * Granular step state inside a SetupRun (`stepName`, `provider`, retries).
 * @see mvp_implementation_plan.md → Database Architecture Strategy (`SetupStepExecution`).
 */
const setupStepExecutionSchema = new mongoose.Schema(
  {
    setupRunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SetupRun',
      required: true,
      index: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    stepName: { type: String, required: true },
    provider: { type: String, enum: PROVIDERS },
    status: {
      type: String,
      enum: STEP_EXECUTION_STATUS,
      default: 'pending',
      index: true,
    },
    attemptCount: { type: Number, default: 0 },
    startedAt: { type: Date },
    endedAt: { type: Date },
    lastErrorSummary: { type: String },
    details: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

setupStepExecutionSchema.index({ setupRunId: 1, stepName: 1 }, { unique: true });

module.exports = mongoose.model('SetupStepExecution', setupStepExecutionSchema);
