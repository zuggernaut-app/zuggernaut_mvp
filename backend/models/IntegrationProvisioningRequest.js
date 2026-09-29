const mongoose = require('mongoose');
const {
  PROVIDERS,
  PROVISIONING_REQUEST_STATUS,
  PROVISIONING_ACTIVE_STATUSES,
  PROVISIONING_RESOURCE_TYPES,
} = require('../constants/enums');

/**
 * Durable consent + provisioning audit trail between OAuth connection and setup-ready identifiers.
 * One active request per (businessId, provider) enforced via partial unique index.
 *
 * @see product_strategy — Discovery + Consent + Provisioning layer (V1 pivot).
 */
const integrationProvisioningRequestSchema = new mongoose.Schema(
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
    /** Resource types the user is asked to approve (e.g. gtm_account, google_ads_customer). */
    requestedResources: {
      type: [{ type: String, enum: PROVISIONING_RESOURCE_TYPES }],
      required: true,
      validate: {
        validator(arr) {
          return Array.isArray(arr) && arr.length > 0;
        },
        message: 'requestedResources must contain at least one resource type',
      },
    },
    /** User who explicitly approved provisioning — null until approved. */
    approvedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    approvedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: PROVISIONING_REQUEST_STATUS,
      default: 'pending_approval',
      index: true,
    },
    /** Provider-native identifiers created or linked after successful provisioning. */
    createdProviderIdentifiers: {
      type: mongoose.Schema.Types.Mixed,
      default: undefined,
    },
    /** Stable machine-readable failure (e.g. ADS_MCC_CREATE_DENIED). */
    errorCode: { type: String, default: null },
    errorMessage: { type: String, default: null },
    /** Optional link to the SetupRun that triggered discovery/provisioning. */
    setupRunId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SetupRun',
      default: null,
      index: true,
      sparse: true,
    },
    /** User who initiated the request (API caller or workflow actor). */
    requestedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    lastAttemptedAt: { type: Date, default: null },
    /** Operator-chosen currency for MCC-created Google Ads accounts (immutable after create). */
    currencyCode: { type: String, enum: ['USD', 'INR'], trim: true },
  },
  { timestamps: true }
);

integrationProvisioningRequestSchema.index({ businessId: 1, provider: 1, createdAt: -1 });
integrationProvisioningRequestSchema.index({ businessId: 1, provider: 1, status: 1 });

integrationProvisioningRequestSchema.index(
  { businessId: 1, provider: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: PROVISIONING_ACTIVE_STATUSES },
    },
  }
);

module.exports = mongoose.model(
  'IntegrationProvisioningRequest',
  integrationProvisioningRequestSchema
);
