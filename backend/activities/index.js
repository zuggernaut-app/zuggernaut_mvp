'use strict';

const {
  checkRobotsActivity,
  scrapeStaticActivity,
  scrapeHeadlessActivity,
  normalizeScrapeActivity,
  persistScrapeResultActivity,
  fillFiveAnswersFromScrapeActivity,
} = require('./scrapeActivities');

const {
  loadSetupContextActivity,
  checkGbpPreconditionsActivity,
  checkGtmPreconditionsActivity,
  checkGoogleAdsConnectionActivity,
  discoverGoogleAdsCustomersActivity,
  ensureGoogleAdsProvisioningApprovalActivity,
  assertGoogleAdsSetupReadyActivity,
  checkGoogleAdsPreconditionsActivity,
  checkProviderPreconditionsActivity,
  checkProvisioningApprovalActivity,
  provisionGtmResourcesActivity,
  provisionGoogleAdsCustomerActivity,
  runGbpAuditActivity,
  manageAdsConversionActionsActivity,
  fetchAdsConversionCatalogActivity,
  runGtmConversionSetupActivity,
  runStructuralVerificationActivity,
  createAdsCampaignActivity,
} = require('./setupRunActivities');

const {
  gracePauseExpiredSubscriptionsActivity,
  pollAdsDisapprovalsActivity,
} = require('./leadCampaignScheduleActivities');

/** Activity name → implementation (see `Worker.create` in `scripts/temporal-worker.js`). */
module.exports = {
  loadSetupContextActivity,
  checkGbpPreconditionsActivity,
  checkGtmPreconditionsActivity,
  checkGoogleAdsConnectionActivity,
  discoverGoogleAdsCustomersActivity,
  ensureGoogleAdsProvisioningApprovalActivity,
  assertGoogleAdsSetupReadyActivity,
  checkGoogleAdsPreconditionsActivity,
  checkProviderPreconditionsActivity,
  checkProvisioningApprovalActivity,
  provisionGtmResourcesActivity,
  provisionGoogleAdsCustomerActivity,
  runGbpAuditActivity,
  manageAdsConversionActionsActivity,
  fetchAdsConversionCatalogActivity,
  runGtmConversionSetupActivity,
  runStructuralVerificationActivity,
  createAdsCampaignActivity,
  checkRobotsActivity,
  scrapeStaticActivity,
  scrapeHeadlessActivity,
  normalizeScrapeActivity,
  persistScrapeResultActivity,
  fillFiveAnswersFromScrapeActivity,
  gracePauseExpiredSubscriptionsActivity,
  pollAdsDisapprovalsActivity,
};
