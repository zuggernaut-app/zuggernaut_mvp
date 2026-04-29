const mongoose = require('mongoose');
const { PROVIDERS, CONNECTION_HEALTH } = require('../constants/enums');

/**
 * GBP / GTM / Google Ads OAuth and connection durability.
 * @see mvp_implementation_plan.md → Database Architecture Strategy (`IntegrationConnection`), Phase 5.
 */
const integrationConnectionSchema = new mongoose.Schema(
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
    /** Connection health for setup dashboard (plan: surface connection health). */
    connectionHealth: {
      type: String,
      enum: CONNECTION_HEALTH,
      default: 'pending',
      index: true,
    },
    /** Provider-native account/container identifiers — not secrets */
    providerIdentifiers: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
    scopes: [{ type: String }],
    tokenExpiryAt: { type: Date },
    /** Never return in API serializers; encrypt at application layer for production */
    accessTokenEnc: {
      type: String,
      select: false,
    },
    refreshTokenEnc: {
      type: String,
      select: false,
    },
  },
  { timestamps: true }
);

integrationConnectionSchema.index({ businessId: 1, provider: 1 }, { unique: true });

module.exports = mongoose.model('IntegrationConnection', integrationConnectionSchema);
