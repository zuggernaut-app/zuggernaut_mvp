const mongoose = require('mongoose');
const { PROVIDERS, ARTIFACT_TYPES } = require('../constants/enums');

/**
 * External resources created or explicitly selected (`externalId` for idempotent retries).
 * Unique `(setupRunId, provider, artifactType, externalId)`.

 * @see mvp_implementation_plan.md → Database Architecture Strategy (`IntegrationArtifact`).
 */
const integrationArtifactSchema = new mongoose.Schema(
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
      index: true,
    },
    provider: {
      type: String,
      required: true,
      enum: PROVIDERS,
      index: true,
    },
    artifactType: {
      type: String,
      required: true,
      enum: ARTIFACT_TYPES,
      index: true,
    },
    /** Stable id in provider's system — idempotency key component */
    externalId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    metadata: { type: mongoose.Schema.Types.Mixed },
    idempotencyKey: { type: String, sparse: true, unique: true },
  },
  { timestamps: true }
);

integrationArtifactSchema.index(
  { setupRunId: 1, provider: 1, artifactType: 1, externalId: 1 },
  { unique: true }
);
integrationArtifactSchema.index({ businessId: 1, setupRunId: 1 });

module.exports = mongoose.model('IntegrationArtifact', integrationArtifactSchema);
