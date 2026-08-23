'use strict';

const mongoose = require('mongoose');
const Subscription = mongoose.model('Subscription');
const Plan = mongoose.model('Plan');
const { isSoftLaunchMode } = require('../../constants/softLaunch');

const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

const GATED_FEATURES = ['setup_start', 'campaign_enable'];

class SubscriptionGateError extends Error {
  constructor(message, code = 'subscription_required', details = {}) {
    super(message);
    this.name = 'SubscriptionGateError';
    this.code = code;
    this.details = details;
  }
}

function isWithinGracePeriod(currentPeriodEnd, now = Date.now()) {
  if (!currentPeriodEnd) return false;
  const endMs =
    currentPeriodEnd instanceof Date
      ? currentPeriodEnd.getTime()
      : new Date(currentPeriodEnd).getTime();
  if (Number.isNaN(endMs)) return false;
  return now <= endMs + GRACE_PERIOD_MS;
}

function isActiveStatus(status) {
  return status === 'active' || status === 'trialing';
}

function parseSoftLaunchTesterEmails() {
  return (process.env.SOFT_LAUNCH_TESTER_EMAILS ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * @param {import('mongoose').Types.ObjectId | string} userId
 * @param {'setup_start' | 'campaign_enable'} feature
 */
async function assertActivePlan(userId, feature) {
  if (!GATED_FEATURES.includes(feature)) {
    throw new TypeError(`Unknown gated feature: ${feature}`);
  }

  const userObjectId =
    userId instanceof mongoose.Types.ObjectId ? userId : new mongoose.Types.ObjectId(userId);

  const User = mongoose.model('User');
  const user = await User.findById(userObjectId).select('primaryOrgId email').lean();

  if (isSoftLaunchMode()) {
    const allowlist = parseSoftLaunchTesterEmails();
    const email = String(user?.email ?? '').trim().toLowerCase();
    if (email && allowlist.includes(email)) {
      console.warn(
        JSON.stringify({
          msg: 'subscription_gate_soft_launch_tester_bypass',
          feature,
          userId: String(userId),
          email,
        })
      );
      return { allowed: true, subscription: null, grace: false, softLaunchTesterBypass: true };
    }
  }

  if (
    process.env.BILLING_FREE_PLAN_TEST === 'true' &&
    (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test')
  ) {
    console.warn(
      JSON.stringify({
        msg: 'subscription_gate_bypass_active',
        feature,
        userId: String(userId),
      })
    );
    return { allowed: true, subscription: null, grace: false };
  }

  // Org billing wins once an org subscription row exists; personal userId is the cutover fallback.
  let subscription = null;
  if (user?.primaryOrgId) {
    subscription = await Subscription.findOne({ orgId: user.primaryOrgId })
      .select('+stripeCustomerId +stripeSubscriptionId')
      .populate('planId')
      .exec();
  }

  if (!subscription) {
    subscription = await Subscription.findOne({ userId: userObjectId })
      .select('+stripeCustomerId +stripeSubscriptionId')
      .populate('planId')
      .exec();
  }

  if (!subscription) {
    throw new SubscriptionGateError(
      'An active subscription is required for this action. Visit Billing to subscribe.',
      'subscription_required',
      { feature, grace: false }
    );
  }

  if (isActiveStatus(subscription.status)) {
    return { allowed: true, subscription, grace: false };
  }

  if (isWithinGracePeriod(subscription.currentPeriodEnd)) {
    return { allowed: true, subscription, grace: true };
  }

  throw new SubscriptionGateError(
    'Your subscription is not active. Visit Billing to restore access.',
    'subscription_lapsed',
    { feature, grace: false, status: subscription.status }
  );
}

/**
 * Upsert subscription row from Stripe webhook payload fields.
 * Sets orgId from the payer's primaryOrgId on first write only (idempotent for webhook retries).
 */
async function upsertSubscriptionFromStripe({
  userId,
  planTier,
  status,
  currentPeriodEnd,
  stripeCustomerId,
  stripeSubscriptionId,
  cancelAtPeriodEnd = false,
}) {
  const userObjectId =
    userId instanceof mongoose.Types.ObjectId ? userId : new mongoose.Types.ObjectId(userId);

  const User = mongoose.model('User');
  const user = await User.findById(userObjectId).select('primaryOrgId').lean();

  let planId;
  if (planTier) {
    const plan = await Plan.findOne({ tier: planTier }).select('_id').lean();
    planId = plan?._id;
  }

  const update = {
    status,
    currentPeriodEnd: currentPeriodEnd ? new Date(currentPeriodEnd) : undefined,
    cancelAtPeriodEnd,
  };
  if (planId) update.planId = planId;
  if (stripeCustomerId) update.stripeCustomerId = stripeCustomerId;
  if (stripeSubscriptionId) update.stripeSubscriptionId = stripeSubscriptionId;

  const existing = await Subscription.findOne({ userId: userObjectId }).select('orgId').lean();
  if (user?.primaryOrgId && !existing?.orgId) {
    update.orgId = user.primaryOrgId;
  }

  return Subscription.findOneAndUpdate(
    { userId: userObjectId },
    { $set: update, $setOnInsert: { userId: userObjectId } },
    { upsert: true, new: true }
  ).exec();
}

module.exports = {
  GRACE_PERIOD_MS,
  SubscriptionGateError,
  assertActivePlan,
  upsertSubscriptionFromStripe,
  isWithinGracePeriod,
};
