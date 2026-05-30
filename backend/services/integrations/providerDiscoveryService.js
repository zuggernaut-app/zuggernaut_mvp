'use strict';

const { discoverGtmProviderIdentifiers } = require('./googleTagManagerClient');
const { discoverGoogleAdsProviderIdentifiers } = require('./googleAdsAccountClient');
const { discoverGbpProviderIdentifiers } = require('./gbpProfileReadClient');
const { buildDiscoveryResult } = require('./providerDiscoveryResult');

/**
 * Mock OAuth discovery — used when GOOGLE_OAUTH_MOCK=true.
 *
 * @param {string} provider
 */
function mockOAuthDiscoveryResult(provider) {
  if (provider === 'gtm') {
    return buildDiscoveryResult('gtm', {
      accountId: 'mock-account',
      containerId: 'mock-container',
      workspaceId: 'mock-workspace',
      publicContainerId: 'GTM-MOCK',
    });
  }
  if (provider === 'google_ads') {
    return buildDiscoveryResult('google_ads', { customerId: 'mock-customer-id' });
  }
  if (provider === 'gbp') {
    return buildDiscoveryResult('gbp', {
      accountName: 'accounts/mock',
      locationName: 'accounts/mock/locations/mock',
    });
  }
  return buildDiscoveryResult(provider, {});
}

/**
 * Read-only provider resource discovery after OAuth — never creates external resources.
 *
 * @param {string} provider
 * @param {string} accessToken
 */
async function discoverProviderConnection(provider, accessToken) {
  if (process.env.GOOGLE_OAUTH_MOCK === 'true') {
    return mockOAuthDiscoveryResult(provider);
  }

  switch (provider) {
    case 'gtm':
      return discoverGtmProviderIdentifiers(accessToken);
    case 'google_ads':
      return discoverGoogleAdsProviderIdentifiers(accessToken);
    case 'gbp':
      return discoverGbpProviderIdentifiers(accessToken);
    default:
      return buildDiscoveryResult(provider, {});
  }
}

module.exports = {
  mockOAuthDiscoveryResult,
  discoverProviderConnection,
};
