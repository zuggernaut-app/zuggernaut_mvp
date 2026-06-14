'use strict';

const mongoose = require('mongoose');
const { SELECTION_SOURCE } = require('../../constants/providerResourceSelection');

const IntegrationConnection = mongoose.model('IntegrationConnection');

/**
 * Persists explicit provider resource selection on IntegrationConnection.
 *
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {'google_ads' | 'gtm'} provider
 * @param {object} providerIdentifiers
 * @param {object} [audit]
 */
async function recordProviderResourceSelection(businessId, provider, providerIdentifiers, audit = {}) {
  const prior = await IntegrationConnection.findOne({ businessId, provider })
    .select('providerIdentifiers')
    .lean();

  const history = Array.isArray(prior?.providerIdentifiers?.selectionHistory)
    ? prior.providerIdentifiers.selectionHistory
    : [];

  const entry = {
    recordedAt: new Date().toISOString(),
    source: audit.source ?? SELECTION_SOURCE.PRODUCT_SETUP,
    ...(audit.summary && typeof audit.summary === 'object' ? { summary: audit.summary } : {}),
  };

  await IntegrationConnection.findOneAndUpdate(
    { businessId, provider },
    {
      $set: {
        connectionHealth: 'connected',
        providerIdentifiers: {
          ...providerIdentifiers,
          selectionRequired: false,
          selectionHistory: [...history.slice(-4), entry],
        },
      },
    }
  );

  return providerIdentifiers;
}

module.exports = { recordProviderResourceSelection };
