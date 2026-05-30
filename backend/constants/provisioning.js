'use strict';

/**
 * Default resource bundle requested when a provider has no usable identifiers after discovery.
 * Used to populate IntegrationProvisioningRequest.requestedResources.
 */
const DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER = Object.freeze({
  gtm: Object.freeze(['gtm_account', 'gtm_container', 'gtm_workspace']),
  google_ads: Object.freeze(['google_ads_customer']),
  gbp: Object.freeze([]),
});

/** Expected IntegrationConnection.providerIdentifiers keys once a provider is setup-ready. */
const REQUIRED_PROVIDER_IDENTIFIER_KEYS = Object.freeze({
  gtm: Object.freeze(['accountId', 'containerId', 'workspaceId']),
  google_ads: Object.freeze(['customerId']),
  gbp: Object.freeze([]),
});

module.exports = {
  DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER,
  REQUIRED_PROVIDER_IDENTIFIER_KEYS,
};
