const mongoose = require('mongoose');

const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
];

const subscriptionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    planId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Plan',
      index: true,
    },
    status: {
      type: String,
      required: true,
      enum: SUBSCRIPTION_STATUSES,
      index: true,
    },
    currentPeriodEnd: { type: Date, index: true },
    stripeCustomerId: { type: String, select: false },
    stripeSubscriptionId: { type: String, select: false },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Org', index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Subscription', subscriptionSchema);
module.exports.SUBSCRIPTION_STATUSES = SUBSCRIPTION_STATUSES;
