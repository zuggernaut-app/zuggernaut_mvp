'use strict';

const { discoverGtmProviderIdentifiers } = require('./googleTagManagerClient');
const { discoverGoogleAdsProviderIdentifiers } = require('./googleAdsAccountClient');
const { discoverGbpProviderIdentifiers } = require('./gbpProfileReadClient');
const {
  buildDiscoveryResult,
  buildSelectionRequiredResult,
  defaultSelectionReason,
} = require('./providerDiscoveryResult');

/**
 * Mock OAuth discovery — used when GOOGLE_OAUTH_MOCK=true.
 *
 * @param {string} provider
 */
function mockOAuthDiscoveryResult(provider) {
  if (provider === 'gtm') {
    return buildSelectionRequiredResult(
      'gtm',
      {
        discoveredAccountCount: 1,
        discoveredContainerCount: 1,
        discoveredWorkspaceCount: 1,
      },
      defaultSelectionReason('gtm')
    );
  }
  if (provider === 'google_ads') {
    return buildSelectionRequiredResult(
      'google_ads',
      {
        accessibleCustomerIds: ['1234567890', '9876543210'],
        loginCustomerId: '3462198684',
        managerCustomerId: '3462198684',
      },
      defaultSelectionReason('google_ads')
    );
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
