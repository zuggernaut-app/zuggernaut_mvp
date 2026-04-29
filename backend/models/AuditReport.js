const mongoose = require('mongoose');

/**
 * GBP audit conclusions vs confirmed `BusinessContext` (present / missing / needs attention).
 * @see mvp_implementation_plan.md → Database Architecture Strategy (`AuditReport`), Phase 6.
 */
const auditReportSchema = new mongoose.Schema(
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
    findings: {
      present: [{ type: String, trim: true }],
      missing: [{ type: String, trim: true }],
      needsAttention: [{ type: String, trim: true }],
    },
    rawProviderRefs: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

auditReportSchema.index({ businessId: 1, setupRunId: 1 }, { unique: true });

module.exports = mongoose.model('AuditReport', auditReportSchema);
