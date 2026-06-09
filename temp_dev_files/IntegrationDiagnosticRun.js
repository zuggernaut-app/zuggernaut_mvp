const mongoose = require('mongoose');
const { PROVIDERS, CREATION_DIAGNOSTIC_RUN_MODES } = require('../constants/enums');

/**
 * Dev-only creation diagnostic run summary — separate from production SetupRun / Temporal.
 * Full step results are stored here for GET /diagnostic-runs/:id (Phase 6).
 */
const integrationDiagnosticRunSchema = new mongoose.Schema(
  {
    diagnosticRunId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    provider: {
      type: String,
      required: true,
      enum: PROVIDERS,
      index: true,
    },
    mode: {
      type: String,
      required: true,
      enum: CREATION_DIAGNOSTIC_RUN_MODES,
    },
    matrixVersion: {
      type: String,
      required: true,
      trim: true,
    },
    ok: {
      type: Boolean,
      required: true,
      index: true,
    },
    startedAt: {
      type: Date,
      required: true,
    },
    completedAt: {
      type: Date,
      required: true,
    },
    message: { type: String, required: true, trim: true },
    errorCode: { type: String, trim: true },
    steps: { type: mongoose.Schema.Types.Mixed, required: true },
    summary: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true }
);

integrationDiagnosticRunSchema.index({ businessId: 1, provider: 1, createdAt: -1 });

module.exports = mongoose.model('IntegrationDiagnosticRun', integrationDiagnosticRunSchema);
