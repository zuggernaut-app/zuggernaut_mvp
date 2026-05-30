'use strict';

const { PROVISIONING_REASON_CODES } = require('../../constants/enums');
const { REQUIRED_PROVIDER_IDENTIFIER_KEYS } = require('../../constants/provisioning');

/**
 * @typedef {object} ProviderDiscoveryResult
 * @property {object} providerIdentifiers
 * @property {'connected' | 'provisioning_required'} connectionHealth
 * @property {string | null} reason — PROVISIONING_REASON_CODES value when applicable
 */

/**
 * @param {string} provider
 * @param {object | null | undefined} identifiers
 * @returns {string[]}
 */
function getMissingIdentifierKeys(provider, identifiers) {
  const keys = REQUIRED_PROVIDER_IDENTIFIER_KEYS[provider] ?? [];
  if (keys.length === 0) return [];
  if (!identifiers || typeof identifiers !== 'object') return [...keys];
  return keys.filter((key) => {
    const val = identifiers[key];
    return val == null || String(val).trim() === '';
  });
}

/**
 * @param {string} provider
 * @param {object | null | undefined} identifiers
 */
function hasRequiredIdentifiers(provider, identifiers) {
  return getMissingIdentifierKeys(provider, identifiers).length === 0;
}

/**
 * @param {string} provider
 * @param {object} providerIdentifiers
 * @param {{ connectionHealth?: string, reason?: string | null }} [opts]
 * @returns {ProviderDiscoveryResult}
 */
function buildDiscoveryResult(provider, providerIdentifiers, opts = {}) {
  const ready = hasRequiredIdentifiers(provider, providerIdentifiers);
  if (provider === 'gbp') {
    return {
      providerIdentifiers,
      connectionHealth: 'connected',
      reason: opts.reason ?? providerIdentifiers.discoveryReason ?? null,
    };
  }

  if (ready) {
    return {
      providerIdentifiers,
      connectionHealth: 'connected',
      reason: null,
    };
  }

  const defaultReason =
    provider === 'gtm'
      ? PROVISIONING_REASON_CODES.find((c) => c === 'GTM_PROVISIONING_REQUIRED')
      : provider === 'google_ads'
        ? PROVISIONING_REASON_CODES.find((c) => c === 'ADS_PROVISIONING_REQUIRED')
        : null;

  return {
    providerIdentifiers: {
      ...providerIdentifiers,
      discoveryReason: opts.reason ?? providerIdentifiers.discoveryReason ?? defaultReason,
    },
    connectionHealth: 'provisioning_required',
    reason: opts.reason ?? providerIdentifiers.discoveryReason ?? defaultReason,
  };
}

module.exports = {
  hasRequiredIdentifiers,
  getMissingIdentifierKeys,
  buildDiscoveryResult,
};
