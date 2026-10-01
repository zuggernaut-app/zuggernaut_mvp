'use strict';

const mongoose = require('mongoose');
const { isSoftLaunchMode } = require('../../constants/softLaunch');

const BusinessContext = mongoose.model('BusinessContext');
const User = mongoose.model('User');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findExistingBusinessContextForUser(userId) {
  return BusinessContext.findOne({ userId })
    .sort({ confirmedAt: -1, updatedAt: -1 })
    .lean();
}

/**
 * @param {import('mongoose').Types.ObjectId} userId
 * @returns {Promise<{ businessId: import('mongoose').Types.ObjectId, created: boolean }>}
 */
async function createBusinessDraftForUser(userId) {
  const existingBusinessContext = await findExistingBusinessContextForUser(userId);
  if (existingBusinessContext) {
    return {
      businessId: existingBusinessContext.businessId,
      created: false,
    };
  }

  let claimedSoftLaunch = false;
  if (isSoftLaunchMode()) {
    const claim = await User.findOneAndUpdate(
      {
        _id: userId,
        softLaunchClaim: { $exists: false },
      },
      { $set: { softLaunchClaim: true } }
    );
    if (!claim) {
      for (let i = 0; i < 3; i++) {
        await sleep(100);
        const foundExisting = await findExistingBusinessContextForUser(userId);
        if (foundExisting) {
          return { businessId: foundExisting.businessId, created: false };
        }
      }
      const err = new Error('Soft launch supports one business per user.');
      err.code = 'soft_launch_single_business';
      throw err;
    }
    claimedSoftLaunch = true;
  }

  const Membership = mongoose.model('Membership');
  let orgId;
  const membership = await Membership.findOne({ userId, role: 'owner' }).lean();
  if (membership?.orgId) {
    orgId = membership.orgId;
  } else {
    const Org = mongoose.model('Org');
    const user = await User.findById(userId).select('email primaryOrgId').lean();
    if (user?.primaryOrgId) {
      orgId = user.primaryOrgId;
    } else {
      const org = await Org.create({
        name: user?.email ? `${user.email} org` : 'My organization',
        ownerUserId: userId,
      });
      orgId = org._id;
      await Membership.create({ orgId, userId, role: 'owner' });
      await User.findByIdAndUpdate(userId, { $set: { primaryOrgId: orgId } });
    }
  }

  let draft;
  try {
    draft = await BusinessContext.create({
      userId,
      orgId,
    });
  } catch (err) {
    if (claimedSoftLaunch) {
      await User.findByIdAndUpdate(userId, { $unset: { softLaunchClaim: '' } });
    }
    throw err;
  }

  await User.findOneAndUpdate(
    {
      _id: userId,
      $or: [{ primaryBusinessId: { $exists: false } }, { primaryBusinessId: null }],
    },
    { $set: { primaryBusinessId: draft.businessId } }
  );

  return { businessId: draft.businessId, created: true };
}

module.exports = {
  findExistingBusinessContextForUser,
  createBusinessDraftForUser,
};
