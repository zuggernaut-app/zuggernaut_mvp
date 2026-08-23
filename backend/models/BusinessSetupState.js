'use strict';

const mongoose = require('mongoose');
const { BUSINESS_SETUP_LOCK_STATE } = require('../constants/businessSetupState');

/**
 * One row per business — atomic guard for concurrent setup starts (T0-1).
 * @see dev-tools/docs/CUSTOMER_ONBOARDING_HARDENING.md T0-1
 */
const businessSetupStateSchema = new mongoose.Schema(
  {
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      unique: true,
      index: true,
    },
    lockState: {
      type: String,
      enum: BUSINESS_SETUP_LOCK_STATE,
      default: 'idle',
      required: true,
      index: true,
    },
    /** Active setup run while `lockState` is `running` (or being claimed). */
    activeSetupRunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SetupRun',
      index: true,
      sparse: true,
    },
    /** Increments on each new setup generation — used by current-run guard. */
    generation: {
      type: Number,
      default: 0,
      min: 0,
    },
    /** When `lockState` is `claiming`, another start may reclaim after this time. */
    claimLeaseExpiresAt: { type: Date },
    /** Set when a prior `succeeded` lock is superseded by `force`. */
    supersededAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('BusinessSetupState', businessSetupStateSchema);
