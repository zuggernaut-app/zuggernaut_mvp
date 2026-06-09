const mongoose = require('mongoose');
const {
  PROVIDERS,
  ARTIFACT_TYPES,
  CREATION_DIAGNOSTIC_RUN_MODES,
  DIAGNOSTIC_ARTIFACT_CLEANUP_STATUS,
} = require('../constants/enums');

/**
 * External resources created during dev-only creation diagnostics.
 * Separate from production `IntegrationArtifact` (setup workflow / Temporal).
 *
 * @see dev-tools/backend/services/dev/integrationDiagnosticArtifactService.js
 */
const integrationDiagnosticArtifactSchema = new mongoose.Schema(
  {
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
    resourceType: {
      type: String,
      required: true,
      enum: ARTIFACT_TYPES,
      index: true,
    },
    /** Provider-native id (customer id, container id, resource name tail, etc.). */
    resourceId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    /** Human-readable provider label or resource name. */
    resourceName: { type: String, trim: true },
    /** Provider API path, e.g. accounts/123/containers/456. */
    resourcePath: { type: String, trim: true },
    /** Deep link to provider UI when available. */
    externalUrl: { type: String, trim: true },
    /** Groups artifacts from one diagnostic execution (Phase 4–6). */
    diagnosticRunId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    /** Matrix step id, e.g. campaign_budget or publish_version. */
    stepId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    /** Matrix action handler id executed for this artifact. */
    action: {
      type: String,
      required: true,
      trim: true,
    },
    mode: {
      type: String,
      required: true,
      enum: CREATION_DIAGNOSTIC_RUN_MODES,
    },
    metadata: { type: mongoose.Schema.Types.Mixed },
    cleanupStatus: {
      type: String,
      enum: DIAGNOSTIC_ARTIFACT_CLEANUP_STATUS,
      default: 'pending',
      index: true,
    },
  },
  { timestamps: true }
);

integrationDiagnosticArtifactSchema.index({ businessId: 1, provider: 1, createdAt: -1 });
integrationDiagnosticArtifactSchema.index({ diagnosticRunId: 1, stepId: 1, resourceId: 1 }, { unique: true });

module.exports = mongoose.model(
  'IntegrationDiagnosticArtifact',
  integrationDiagnosticArtifactSchema
);
