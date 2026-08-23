'use strict';

const mongoose = require('mongoose');

/**
 * Move subscription billing from userId to orgId for org-based teams.
 */
async function migrateUserSubscriptionsToOrg() {
  const User = mongoose.model('User');
  const Subscription = mongoose.model('Subscription');
  const BusinessContext = mongoose.model('BusinessContext');
  const Membership = mongoose.model('Membership');

  const subs = await Subscription.find({ userId: { $exists: true }, orgId: { $exists: false } })
    .select('+stripeCustomerId +stripeSubscriptionId userId')
    .lean();

  let migrated = 0;
  for (const sub of subs) {
    const membership = await Membership.findOne({ userId: sub.userId, role: 'owner' }).lean();
    let orgId = membership?.orgId;
    if (!orgId) {
      const bc = await BusinessContext.findOne({ userId: sub.userId }).select('orgId').lean();
      orgId = bc?.orgId;
    }
    if (!orgId) continue;

    await Subscription.updateOne({ _id: sub._id }, { $set: { orgId } });
    await User.findByIdAndUpdate(sub.userId, { $set: { primaryOrgId: orgId } });
    migrated += 1;
  }

  return { migrated, scanned: subs.length };
}

module.exports = {
  migrateUserSubscriptionsToOrg,
};
