const mongoose = require('mongoose');
const { PROVIDERS, SNAPSHOT_TYPES } = require('../constants/enums');

/**
 * Read-only payloads from provider APIs (not the registry of created resource ids).
 * Plan: immutable/versioned snapshots — use `immutable` / `snapshotVersion` for dedupe/versioning.
 * @see mvp_implementation_plan.md → Database Architecture Strategy (`ProviderSnapshot`).
 */
const providerSnapshotSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    setupRunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SetupRun',
      index: true,
    },
    provider: {
      type: String,
      required: true,
      enum: PROVIDERS,
      index: true,
    },
    snapshotType: {
      type: String,
      required: true,
      enum: SNAPSHOT_TYPES,
      index: true,
    },
    /** API response envelope or normalized read model */
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    sourceVersionHint: { type: String },
    /** When true, treat row as immutable read snapshot */
    immutable: { type: Boolean, default: true },
    snapshotVersion: { type: Number, default: 1, min: 1 },
  },
  { timestamps: true }
);

providerSnapshotSchema.index({ businessId: 1, setupRunId: 1, snapshotType: 1, provider: 1 });

module.exports = mongoose.model('ProviderSnapshot', providerSnapshotSchema);
