/**
 * Shared string enums — keep in sync with:
 * `mvp_implementation_plan.md` → Database Architecture Strategy, Phase 3 (workflow states), Phase 5 (connections).
 */

const PROVIDERS = Object.freeze(['gbp', 'gtm', 'google_ads']);

const CONNECTION_HEALTH = Object.freeze([
  'connected',
  'disconnected',
  'needs_reauth',
  'error',
  'pending',
]);

/** MongoDB-visible setup run summary (Temporal holds execution truth; this feeds API/dashboard). */
const SETUP_RUN_STATUS = Object.freeze([
  'USER_INPUT_COLLECTED',
  'GBP_CONNECTED',
  'GBP_AUDIT_COMPLETE',
  'GTM_CONNECTED',
  'ADS_CONNECTED',
  'CONVERSION_CATALOG_READY',
  'GTM_SETUP_COMPLETE',
  'GTM_SNIPPET_PENDING',
  'STRUCTURAL_VERIFIED',
  'SETUP_NEEDS_TRACKING_FIX',
  'ADS_CAMPAIGNS_CREATED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
]);

const STEP_EXECUTION_STATUS = Object.freeze([
  'pending',
  'running',
  'success',
  'failed',
  'retrying',
  'skipped',
]);

/** What kind of read-only blob was persisted in ProviderSnapshot.payload */
const SNAPSHOT_TYPES = Object.freeze([
  'gbp_profile_read',
  'ads_conversion_catalog',
  'gtm_container_version',
  'other',
]);

/**
 * Narrow categories for IntegrationArtifact — extend as workflows solidify.
 * Examples: gtm_tag, gtm_trigger, ads_campaign, ads_ad_group, ads_conversion_link
 */
const ARTIFACT_TYPES = Object.freeze([
  'gbp_location',
  'gtm_container',
  'gtm_tag',
  'gtm_trigger',
  'gtm_variable',
  'ads_customer',
  'ads_campaign',
  'ads_ad_group',
  'ads_ad',
  'ads_conversion_action',
  'other',
]);

const CAMPAIGN_PLAN_STATUS = Object.freeze(['draft', 'ready', 'applied', 'superseded']);

/** Async website scrape job (Temporal orchestration; raw output stored on BusinessContext). */
const SCRAPE_RUN_STATUS = Object.freeze([
  'QUEUED',
  'RUNNING',
  'SUCCEEDED',
  'PARTIAL',
  'BLOCKED',
  'FAILED',
]);

module.exports = {
  PROVIDERS,
  CONNECTION_HEALTH,
  SETUP_RUN_STATUS,
  STEP_EXECUTION_STATUS,
  SNAPSHOT_TYPES,
  ARTIFACT_TYPES,
  CAMPAIGN_PLAN_STATUS,
  SCRAPE_RUN_STATUS,
};
