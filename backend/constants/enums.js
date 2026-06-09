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
  /** OAuth connected but provider-native resources (account/container/customer) not yet discovered or provisioned. */
  'provisioning_required',
  /** OAuth connected and resources discovered, but user must explicitly select Ads customer or GTM hierarchy. */
  'selection_required',
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
  // Provider OAuth/connection missing or needs human intervention before automation can continue.
  'SETUP_NEEDS_MANUAL_REVIEW',
  'ADS_CAMPAIGNS_CREATED',
  'RUNNING',
  'SUCCEEDED',
  'FAILED',
  /** GTM account/container/workspace missing — awaiting user approval to provision. */
  'GTM_PROVISIONING_REQUIRED',
  /** GTM resources created or linked; identifiers persisted on IntegrationConnection. */
  'GTM_PROVISIONED',
  /** Google Ads customer missing — awaiting user approval to provision via MCC. */
  'ADS_PROVISIONING_REQUIRED',
  /** Google Ads customer created or linked; customerId persisted on IntegrationConnection. */
  'ADS_PROVISIONED',
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
  'gtm_account',
  'gtm_container',
  'gtm_workspace',
  'gtm_tag',
  'gtm_trigger',
  'gtm_variable',
  'gtm_builtin_variable',
  'gtm_container_version',
  'gtm_container_publish',
  'ads_customer',
  'ads_manager_link',
  'ads_campaign',
  'ads_ad_group',
  'ads_ad',
  'ads_keyword',
  'ads_conversion_action',
  'ads_campaign_budget',
  'ads_conversion_link',
  'ads_campaign_criterion',
  'ads_asset_sitelink',
  'ads_asset_callout',
  'ads_asset_call',
  'ads_remarketing_list',
  'ads_negative_keyword_list',
  'ads_offline_conversion_import',
  /** Dev integrations: explicit user-selected Ads customer (audit metadata on connection). */
  'ads_selected_customer',
  /** Dev integrations: explicit user-selected GTM workspace hierarchy. */
  'gtm_selected_workspace',
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

/** Lifecycle of an IntegrationProvisioningRequest (consent + provisioning audit trail). */
const PROVISIONING_REQUEST_STATUS = Object.freeze([
  'pending_approval',
  'approved',
  'provisioning',
  'provisioned',
  'failed',
  'cancelled',
]);

/** Statuses that block creating another active provisioning request for the same business + provider. */
const PROVISIONING_ACTIVE_STATUSES = Object.freeze([
  'pending_approval',
  'approved',
  'provisioning',
]);

/**
 * Stable reason codes surfaced during discovery/readiness checks.
 * GBP codes are informational — setup does not block on GBP.
 */
const PROVISIONING_REASON_CODES = Object.freeze([
  'GTM_PROVISIONING_REQUIRED',
  'ADS_PROVISIONING_REQUIRED',
  'GBP_NO_ACCOUNTS',
  'GBP_NO_LOCATIONS',
]);

/** Stable reason codes when OAuth succeeded but explicit resource selection is required. */
const SELECTION_REASON_CODES = Object.freeze([
  'ADS_CUSTOMER_SELECTION_REQUIRED',
  'GTM_RESOURCE_SELECTION_REQUIRED',
]);

/** Resource types a user may approve for automatic creation/linking. */
const PROVISIONING_RESOURCE_TYPES = Object.freeze([
  'gtm_account',
  'gtm_container',
  'gtm_workspace',
  'google_ads_customer',
]);

/** Dev-only creation diagnostic run modes (Phase 2). */
const CREATION_DIAGNOSTIC_RUN_MODES = Object.freeze([
  'validate_only',
  'create_paused',
  'create_and_publish',
]);

/** Cleanup lifecycle for resources created during dev creation diagnostics. */
const DIAGNOSTIC_ARTIFACT_CLEANUP_STATUS = Object.freeze([
  'pending',
  'retained',
  'cleanup_requested',
  'cleaned_up',
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
  PROVISIONING_REQUEST_STATUS,
  PROVISIONING_ACTIVE_STATUSES,
  PROVISIONING_REASON_CODES,
  SELECTION_REASON_CODES,
  PROVISIONING_RESOURCE_TYPES,
  CREATION_DIAGNOSTIC_RUN_MODES,
  DIAGNOSTIC_ARTIFACT_CLEANUP_STATUS,
};
