'use strict';

const mongoose = require('mongoose');

const IntegrationConnection = mongoose.model('IntegrationConnection');

class ProviderResourceExclusiveError extends Error {
  /**
   * @param {string} message
   * @param {string} [code]
   */
  constructor(message, code = 'provider_resource_in_use') {
    super(message);
    this.name = 'ProviderResourceExclusiveError';
    this.code = code;
  }
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {'google_ads' | 'gtm' | 'gbp'} provider
 * @param {'customerId' | 'containerId' | 'locationName'} field
 * @param {string} resourceId
 */
async function assertProviderResourceExclusive(businessId, provider, field, resourceId) {
  const normalized = String(resourceId ?? '').trim();
  if (!normalized) return;

  const bid =
    businessId instanceof mongoose.Types.ObjectId
      ? businessId
      : new mongoose.Types.ObjectId(String(businessId));

  const path = `providerIdentifiers.${field}`;
  const conflict = await IntegrationConnection.findOne({
    provider,
    businessId: { $ne: bid },
    [path]: normalized,
  })
    .select('businessId')
    .lean();

  if (conflict) {
    throw new ProviderResourceExclusiveError(
      `This ${provider} resource is already linked to another business.`,
      'provider_resource_in_use'
    );
  }
}

module.exports = {
  ProviderResourceExclusiveError,
  assertProviderResourceExclusive,
};
