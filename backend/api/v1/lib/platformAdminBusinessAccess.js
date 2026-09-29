'use strict';

const mongoose = require('mongoose');
const User = mongoose.model('User');
const { assertBusinessAccess } = require('./assertBusinessAccess');
const {
  assertBusinessMembershipOrOwnership,
  MembershipCheckError,
} = require('../../../lib/auth/membershipCheck');

/**
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function isPlatformAdminUser(userId) {
  const user = await User.findById(userId).select('platformAdmin').lean();
  return Boolean(user?.platformAdmin);
}

/**
 * Membership check with platform-admin bypass (throws MembershipCheckError).
 * @param {string} userId
 * @param {string} businessIdRaw
 */
async function assertBusinessMembershipOrPlatformAdmin(userId, businessIdRaw) {
  if (await isPlatformAdminUser(userId)) {
    return;
  }
  await assertBusinessMembershipOrOwnership(userId, businessIdRaw);
}

/**
 * assertBusinessAccess-style helper with platform-admin bypass.
 * @param {string} userId
 * @param {string} businessIdRaw
 * @returns {Promise<{ platformAdmin: true, businessId: import('mongoose').Types.ObjectId } | Awaited<ReturnType<typeof assertBusinessAccess>> | null>}
 */
async function assertBusinessAccessOrPlatformAdmin(userId, businessIdRaw) {
  if (await isPlatformAdminUser(userId)) {
    if (!mongoose.Types.ObjectId.isValid(businessIdRaw)) {
      return null;
    }
    return { platformAdmin: true, businessId: new mongoose.Types.ObjectId(businessIdRaw) };
  }
  return assertBusinessAccess(userId, businessIdRaw);
}

module.exports = {
  isPlatformAdminUser,
  assertBusinessMembershipOrPlatformAdmin,
  assertBusinessAccessOrPlatformAdmin,
  MembershipCheckError,
};
