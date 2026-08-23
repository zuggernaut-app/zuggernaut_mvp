'use strict';

const mongoose = require('mongoose');

const ROLE_RANK = { member: 1, admin: 2, owner: 3 };

class MembershipCheckError extends Error {
  constructor(message, code = 'forbidden') {
    super(message);
    this.name = 'MembershipCheckError';
    this.code = code;
  }
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function resolveOrgIdForBusiness(businessId) {
  const BusinessContext = mongoose.model('BusinessContext');
  const bc = await BusinessContext.findOne({ businessId }).select('orgId userId').lean();
  if (!bc) return null;
  if (bc.orgId) return bc.orgId;
  return null;
}

/**
 * @param {import('mongoose').Types.ObjectId | string} userId
 * @param {import('mongoose').Types.ObjectId | string} orgId
 * @param {string} [minRole]
 */
async function assertMembership(userId, orgId, minRole = 'member') {
  const Membership = mongoose.model('Membership');
  const userObjectId =
    userId instanceof mongoose.Types.ObjectId ? userId : new mongoose.Types.ObjectId(userId);
  const orgObjectId =
    orgId instanceof mongoose.Types.ObjectId ? orgId : new mongoose.Types.ObjectId(orgId);

  const membership = await Membership.findOne({ userId: userObjectId, orgId: orgObjectId }).lean();
  if (!membership) {
    throw new MembershipCheckError('You do not have access to this organization.', 'forbidden');
  }

  const requiredRank = ROLE_RANK[minRole] ?? ROLE_RANK.member;
  const actualRank = ROLE_RANK[membership.role] ?? 0;
  if (actualRank < requiredRank) {
    throw new MembershipCheckError('Insufficient organization role for this action.', 'forbidden');
  }

  return membership;
}

/**
 * Prefer org membership when BusinessContext.orgId is set; fall back to legacy userId ownership.
 */
async function assertBusinessMembershipOrOwnership(userId, businessIdRaw) {
  if (!businessIdRaw || !mongoose.Types.ObjectId.isValid(businessIdRaw)) {
    throw new MembershipCheckError('Invalid businessId', 'validation_error');
  }

  const businessId = new mongoose.Types.ObjectId(businessIdRaw);
  const userObjectId =
    userId instanceof mongoose.Types.ObjectId ? userId : new mongoose.Types.ObjectId(userId);
  const BusinessContext = mongoose.model('BusinessContext');

  const bc = await BusinessContext.findOne({ businessId }).select('orgId userId').lean();
  if (!bc) {
    throw new MembershipCheckError('Business context not found', 'not_found');
  }

  if (bc.orgId) {
    await assertMembership(userObjectId, bc.orgId, 'member');
    return { businessId, orgId: bc.orgId };
  }

  if (bc.userId?.toString() !== userObjectId.toString()) {
    throw new MembershipCheckError('Business context not found for this user', 'not_found');
  }

  return { businessId, orgId: null };
}

/**
 * Org ids the user belongs to via Membership (for business list scoping).
 * @param {import('mongoose').Types.ObjectId | string} userId
 * @returns {Promise<import('mongoose').Types.ObjectId[]>}
 */
async function listOrgIdsForUser(userId) {
  const Membership = mongoose.model('Membership');
  const userObjectId =
    userId instanceof mongoose.Types.ObjectId ? userId : new mongoose.Types.ObjectId(userId);
  const rows = await Membership.find({ userId: userObjectId }).select('orgId').lean();
  return rows.map((row) => row.orgId).filter(Boolean);
}

module.exports = {
  MembershipCheckError,
  resolveOrgIdForBusiness,
  assertMembership,
  assertBusinessMembershipOrOwnership,
  listOrgIdsForUser,
};
