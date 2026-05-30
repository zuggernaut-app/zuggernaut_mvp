'use strict';

const mongoose = require('mongoose');
const BusinessContext = mongoose.model('BusinessContext');

/**
 * @param {string} userId
 * @param {string} businessIdRaw
 * @returns {Promise<{ businessId: import('mongoose').Types.ObjectId } | null>}
 */
async function assertBusinessAccess(userId, businessIdRaw) {
  if (!businessIdRaw || !mongoose.Types.ObjectId.isValid(businessIdRaw)) {
    return null;
  }
  const businessId = new mongoose.Types.ObjectId(businessIdRaw);
  const userObjectId = new mongoose.Types.ObjectId(userId);
  const exists = await BusinessContext.exists({ businessId, userId: userObjectId });
  if (!exists) return null;
  return { businessId };
}

module.exports = { assertBusinessAccess };
