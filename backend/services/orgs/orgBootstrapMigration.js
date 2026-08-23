'use strict';

const mongoose = require('mongoose');

/**
 * Bootstrap one org per user owning business contexts; set BusinessContext.orgId.
 */
async function bootstrapOrgsForExistingUsers() {
  const User = mongoose.model('User');
  const Org = mongoose.model('Org');
  const Membership = mongoose.model('Membership');
  const BusinessContext = mongoose.model('BusinessContext');

  const userIds = await BusinessContext.distinct('userId');
  let orgsCreated = 0;
  let businessesUpdated = 0;

  for (const userId of userIds) {
    const user = await User.findById(userId).select('email primaryOrgId').lean();
    if (!user) continue;

    let orgId = user.primaryOrgId;
    if (!orgId) {
      const existingMembership = await Membership.findOne({ userId, role: 'owner' }).lean();
      orgId = existingMembership?.orgId;
    }

    if (!orgId) {
      const org = await Org.create({
        name: user.email ? `${user.email} org` : 'My organization',
        ownerUserId: userId,
      });
      orgId = org._id;
      await Membership.create({ orgId, userId, role: 'owner' });
      await User.findByIdAndUpdate(userId, { $set: { primaryOrgId: orgId } });
      orgsCreated += 1;
    }

    const result = await BusinessContext.updateMany(
      { userId, orgId: { $exists: false } },
      { $set: { orgId } }
    );
    const result2 = await BusinessContext.updateMany({ userId, orgId: null }, { $set: { orgId } });
    businessesUpdated += (result.modifiedCount ?? 0) + (result2.modifiedCount ?? 0);
  }

  return { orgsCreated, businessesUpdated, usersScanned: userIds.length };
}

module.exports = {
  bootstrapOrgsForExistingUsers,
};
