'use strict';

/**
 * Logical step names — unique per SetupRun (see SetupStepExecution index).
 * Do not rename once persisted in Mongo or referenced by Temporal activity histories.
 */
const SETUP_STEP_NAMES = Object.freeze({
  LOAD_CONTEXT: 'load_setup_context',
  PROVIDER_PRECONDITIONS: 'provider_preconditions',
  CHECK_GBP_CONNECTION: 'check_gbp_connection',
  CHECK_GTM_CONNECTION: 'check_gtm_connection',
  CHECK_GOOGLE_ADS_CONNECTION: 'check_google_ads_connection',
  DISCOVER_PROVIDER_RESOURCES: 'discover_provider_resources',
  CHECK_PROVISIONING_APPROVAL: 'check_provisioning_approval',
  PROVISION_GTM_RESOURCES: 'provision_gtm_resources',
  PROVISION_GOOGLE_ADS_CUSTOMER: 'provision_google_ads_customer',
  GBP_AUDIT: 'gbp_audit',
  ADS_CONVERSION_CATALOG: 'ads_conversion_catalog',
  GTM_CONVERSION_SETUP: 'gtm_conversion_setup',
  STRUCTURAL_VERIFICATION: 'structural_verification',
  ADS_CAMPAIGN_CREATION: 'ads_campaign_creation',
});

/**
 * Stable terminal outcomes returned by `setupRunWorkflow`.
 * Activity-layer outcomes map into this set; do not invent new terminal strings in the workflow.
 */
const SETUP_WORKFLOW_TERMINALS = Object.freeze({
  INVALID: 'invalid',
  FAILED: 'failed',
  MANUAL_REVIEW: 'manual_review',
  NEEDS_TRACKING_FIX: 'needs_tracking_fix',
  SNIPPET_PENDING: 'snippet_pending',
  GBP_BLOCKED: 'gbp_blocked',
  GTM_PROVISIONING_REQUIRED: 'gtm_provisioning_required',
  ADS_PROVISIONING_REQUIRED: 'ads_provisioning_required',
  SUCCEEDED: 'succeeded',
});

/** SetupRun.status values activities may patch — high-level workflow states only. */
const SETUP_RUN_PATCH_STATUS = Object.freeze({
  RUNNING: 'RUNNING',
  FAILED: 'FAILED',
  SUCCEEDED: 'SUCCEEDED',
  SETUP_NEEDS_MANUAL_REVIEW: 'SETUP_NEEDS_MANUAL_REVIEW',
  SETUP_NEEDS_TRACKING_FIX: 'SETUP_NEEDS_TRACKING_FIX',
  GTM_SNIPPET_PENDING: 'GTM_SNIPPET_PENDING',
  GTM_PROVISIONING_REQUIRED: 'GTM_PROVISIONING_REQUIRED',
  GTM_PROVISIONED: 'GTM_PROVISIONED',
  ADS_PROVISIONING_REQUIRED: 'ADS_PROVISIONING_REQUIRED',
  ADS_PROVISIONED: 'ADS_PROVISIONED',
});

/** Activity names proxied by setupRunWorkflow — must match worker registration in activities/index.js. */
const SETUP_RUN_WORKFLOW_ACTIVITIES = Object.freeze([
  'loadSetupContextActivity',
  'checkGbpPreconditionsActivity',
  'checkGtmPreconditionsActivity',
  'checkGoogleAdsPreconditionsActivity',
  'checkProvisioningApprovalActivity',
  'provisionGtmResourcesActivity',
  'provisionGoogleAdsCustomerActivity',
  'runGbpAuditActivity',
  'fetchAdsConversionCatalogActivity',
  'runGtmConversionSetupActivity',
  'runStructuralVerificationActivity',
  'createAdsCampaignActivity',
]);

module.exports = {
  SETUP_STEP_NAMES,
  SETUP_WORKFLOW_TERMINALS,
  SETUP_RUN_PATCH_STATUS,
  SETUP_RUN_WORKFLOW_ACTIVITIES,
};
