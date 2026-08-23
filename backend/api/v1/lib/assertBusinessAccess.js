'use strict';

const mongoose = require('mongoose');
const {
  assertBusinessMembershipOrOwnership,
  MembershipCheckError,
} = require('../../../lib/auth/membershipCheck');

/**
 * @param {string} userId
 * @param {string} businessIdRaw
 * @returns {Promise<{ businessId: import('mongoose').Types.ObjectId, orgId?: import('mongoose').Types.ObjectId | null } | null>}
 */
async function assertBusinessAccess(userId, businessIdRaw) {
  try {
    return await assertBusinessMembershipOrOwnership(userId, businessIdRaw);
  } catch (err) {
    if (err instanceof MembershipCheckError) {
      return null;
    }
    throw err;
  }
}

module.exports = { assertBusinessAccess, MembershipCheckError };
