const mongoose = require('mongoose');

/**
 * Identity model. `primaryBusinessId` must match `BusinessContext.businessId` for the user’s primary tenant when set.
 * @see mvp_implementation_plan.md → Database Architecture Strategy (`User`).
 */
const userSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    name: { type: String, trim: true },
    phone: { type: String, trim: true },
    websiteUrl: { type: String, trim: true },
    /** bcrypt password hash — never returned from API selectors by default (`select:false`) */
    passwordHash: { type: String, select: false },
    /** Google OAuth subject (OpenID "sub") when using Google sign-in */
    googleSub: { type: String, sparse: true, unique: true, index: true },
    /** Primary tenant key for the business this user owns (matches BusinessContext.businessId) */
    primaryBusinessId: { type: mongoose.Schema.Types.ObjectId, index: true },
    /** SHA-256 hash of one-time password-reset token — never store plaintext */
    passwordResetToken: { type: String, select: false },
    /** Expiry for `passwordResetToken`; cleared after successful reset */
    passwordResetExpiresAt: { type: Date, select: false },
    /** Set when the user completes email verification (unused until verify flow ships) */
    emailVerifiedAt: { type: Date },
    /** Break-glass ops flag until org RBAC is universal (T2-10) */
    platformAdmin: { type: Boolean, default: false, index: true },
    /** Primary org for billing/teams (one org per user in V1) */
    primaryOrgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Org', index: true },
    /** CAS flag: set when user claims their one soft-launch business slot (SOFT_LAUNCH_MODE only). */
    softLaunchClaim: { type: Boolean },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
