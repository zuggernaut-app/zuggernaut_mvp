const mongoose = require('mongoose');

const PLAN_TIERS = ['starter', 'middle', 'top'];

const planSchema = new mongoose.Schema(
  {
    tier: {
      type: String,
      required: true,
      unique: true,
      enum: PLAN_TIERS,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    stripePriceId: { type: String, trim: true },
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Plan', planSchema);
module.exports.PLAN_TIERS = PLAN_TIERS;
