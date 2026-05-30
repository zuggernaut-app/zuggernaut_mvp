'use strict';

const {
  checkRobotsActivity,
  scrapeStaticActivity,
  scrapeHeadlessActivity,
  normalizeScrapeActivity,
  persistScrapeResultActivity,
} = require('./scrapeActivities');

const {
  loadSetupContextActivity,
  checkGbpPreconditionsActivity,
  checkGtmPreconditionsActivity,
  checkGoogleAdsPreconditionsActivity,
  checkProviderPreconditionsActivity,
  checkProvisioningApprovalActivity,
  provisionGtmResourcesActivity,
  provisionGoogleAdsCustomerActivity,
  runGbpAuditActivity,
  fetchAdsConversionCatalogActivity,
  runGtmConversionSetupActivity,
  runStructuralVerificationActivity,
  createAdsCampaignActivity,
} = require('./setupRunActivities');

/** Activity name → implementation (see `Worker.create` in `scripts/temporal-worker.js`). */
module.exports = {
  loadSetupContextActivity,
  checkGbpPreconditionsActivity,
  checkGtmPreconditionsActivity,
  checkGoogleAdsPreconditionsActivity,
  checkProviderPreconditionsActivity,
  checkProvisioningApprovalActivity,
  provisionGtmResourcesActivity,
  provisionGoogleAdsCustomerActivity,
  runGbpAuditActivity,
  fetchAdsConversionCatalogActivity,
  runGtmConversionSetupActivity,
  runStructuralVerificationActivity,
  createAdsCampaignActivity,
  checkRobotsActivity,
  scrapeStaticActivity,
  scrapeHeadlessActivity,
  normalizeScrapeActivity,
  persistScrapeResultActivity,
};
