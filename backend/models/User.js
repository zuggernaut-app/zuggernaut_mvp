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
    /** Google OAuth subject (OpenID "sub") when using Google sign-in */
    googleSub: { type: String, sparse: true, unique: true, index: true },
    /** Primary tenant key for the business this user owns (matches BusinessContext.businessId) */
    primaryBusinessId: { type: mongoose.Schema.Types.ObjectId, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
