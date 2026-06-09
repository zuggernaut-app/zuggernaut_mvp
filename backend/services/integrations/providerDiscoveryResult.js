'use strict';

const { PROVISIONING_REASON_CODES, SELECTION_REASON_CODES } = require('../../constants/enums');
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

/**
 * OAuth succeeded and accessible resources were discovered, but setup-ready identifiers
 * require explicit user selection (no silent first-match default).
 *
 * @param {string} provider
 * @param {object} providerIdentifiers
 * @param {string} reason — SELECTION_REASON_CODES value
 * @returns {ProviderDiscoveryResult}
 */
function buildSelectionRequiredResult(provider, providerIdentifiers, reason) {
  return {
    providerIdentifiers: {
      ...providerIdentifiers,
      selectionRequired: true,
      discoveryReason: reason,
    },
    connectionHealth: 'selection_required',
    reason,
  };
}

/**
 * @param {string} provider
 */
function defaultSelectionReason(provider) {
  if (provider === 'google_ads') {
    return SELECTION_REASON_CODES.find((c) => c === 'ADS_CUSTOMER_SELECTION_REQUIRED');
  }
  if (provider === 'gtm') {
    return SELECTION_REASON_CODES.find((c) => c === 'GTM_RESOURCE_SELECTION_REQUIRED');
  }
  return null;
}

module.exports = {
  hasRequiredIdentifiers,
  getMissingIdentifierKeys,
  buildDiscoveryResult,
  buildSelectionRequiredResult,
  defaultSelectionReason,
};
