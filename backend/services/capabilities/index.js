'use strict';

const integrationConnection = require('./integrationConnectionService');
const { runGbpReadOnlyAudit, GbpProviderPreconditionError } = require('./gbpReadOnlyAuditService');
const { fetchAndPersistConversionCatalog, AdsCatalogPreconditionError } = require('./adsConversionCatalogService');
const { runGtmConversionSetup, GtmProviderPreconditionError } = require('./gtmConversionSetupService');
const { provisionGtmResources, GtmProvisioningError } = require('./gtmProvisioningService');
const { provisionGoogleAdsCustomer, AdsProvisioningError } = require('./adsProvisioningService');
const {
  getProvisioningOverview,
  createProvisioningRequest,
  ensureSetupProvisioningRequest,
  checkSetupProvisioningApproval,
  approveProvisioningRequest,
  executeProvisioningRequest,
  cancelProvisioningRequest,
  ProvisioningServiceError,
  PROVISIONING_PROVIDERS,
} = require('./integrationProvisioningService');
const { runStructuralVerification } = require('./structuralVerificationService');
const { createAdsAutoCampaign, AdsProviderPreconditionError } = require('./adsAutoCampaignService');
const {
  verifyGoogleAdsOAuthConnection,
  discoverAndPersistGoogleAdsCustomers,
  ensureGoogleAdsProvisioningApproval,
  assertGoogleAdsSetupReady,
  GoogleAdsSetupError,
} = require('./googleAdsSetupService');
const {
  loadSetupReadyConnection,
  requireSetupReadyConnection,
  SetupReadyConnectionError,
  normalizeGtmIdentifiers,
  validateGtmIdentifiers,
} = require('./setupReadyConnectionService');

module.exports = {
  ...integrationConnection,
  runGbpReadOnlyAudit,
  GbpProviderPreconditionError,
  fetchAndPersistConversionCatalog,
  AdsCatalogPreconditionError,
  runGtmConversionSetup,
  GtmProviderPreconditionError,
  provisionGtmResources,
  GtmProvisioningError,
  provisionGoogleAdsCustomer,
  AdsProvisioningError,
  getProvisioningOverview,
  createProvisioningRequest,
  ensureSetupProvisioningRequest,
  checkSetupProvisioningApproval,
  approveProvisioningRequest,
  executeProvisioningRequest,
  cancelProvisioningRequest,
  ProvisioningServiceError,
  PROVISIONING_PROVIDERS,
  runStructuralVerification,
  createAdsAutoCampaign,
  AdsProviderPreconditionError,
  loadSetupReadyConnection,
  requireSetupReadyConnection,
  SetupReadyConnectionError,
  normalizeGtmIdentifiers,
  validateGtmIdentifiers,
  verifyGoogleAdsOAuthConnection,
  discoverAndPersistGoogleAdsCustomers,
  ensureGoogleAdsProvisioningApproval,
  assertGoogleAdsSetupReady,
  GoogleAdsSetupError,
};
