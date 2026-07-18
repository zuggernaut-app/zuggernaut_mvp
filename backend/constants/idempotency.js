'use strict';

const { SETUP_STEP_NAMES } = require('./setupWorkflow');

/**
 * Stable idempotency key builders for provider-changing setup activities.
 * Every external create/select must lookup IntegrationArtifact by idempotencyKey before mutating.
 */

/**
 * @param {import('mongoose').Types.ObjectId | string} setupRunId
 * @param {string} logicalKey
 */
function gtmConversionIdempotencyKey(setupRunId, logicalKey) {
  return `gtm-${setupRunId}-${logicalKey}`;
}

/**
 * @param {import('mongoose').Types.ObjectId | string} setupRunId
 * @param {string} logicalKey
 */
function adsCampaignIdempotencyKey(setupRunId, logicalKey) {
  return `ads-${setupRunId}-${logicalKey}`;
}

/**
 * @param {import('mongoose').Types.ObjectId | string} setupRunId
 * @param {string} logicalCategory
 */
function adsConversionCatalogIdempotencyKey(setupRunId, logicalCategory) {
  return `ads-ca-${setupRunId}-${logicalCategory}`;
}

/**
 * @param {import('mongoose').Types.ObjectId | string} setupRunId
 * @param {string} slot — 'call' | 'form'
 */
function adsConversionActionCreationIdempotencyKey(setupRunId, slot) {
  return `ads-ca-create-${setupRunId}-${slot}`;
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {import('mongoose').Types.ObjectId | string} setupRunId
 * @param {'account' | 'container' | 'workspace'} resource
 */
function gtmProvisioningIdempotencyKey(businessId, setupRunId, resource) {
  return `gtm:${resource}:${businessId}:${setupRunId}`;
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {import('mongoose').Types.ObjectId | string} setupRunId
 */
function adsProvisioningIdempotencyKey(businessId, setupRunId) {
  return `ads:customer:${businessId}:${setupRunId}`;
}

/**
 * Contract for provider-changing setup activities — used by tests and ops review.
 * lookupBeforeCreate: IntegrationArtifact query pattern before external mutation.
 */
const PROVIDER_MUTATION_CONTRACT = Object.freeze([
  {
    stepName: SETUP_STEP_NAMES.PROVISION_GTM_RESOURCES,
    provider: 'gtm',
    service: 'gtmProvisioningService',
    artifactTypes: ['gtm_account', 'gtm_container', 'gtm_workspace'],
    idempotencyKey: (ctx) =>
      gtmProvisioningIdempotencyKey(ctx.businessId, ctx.setupRunId, ctx.resource),
  },
  {
    stepName: SETUP_STEP_NAMES.PROVISION_GOOGLE_ADS_CUSTOMER,
    provider: 'google_ads',
    service: 'adsProvisioningService',
    artifactTypes: ['ads_customer'],
    idempotencyKey: (ctx) => adsProvisioningIdempotencyKey(ctx.businessId, ctx.setupRunId),
  },
  {
    stepName: SETUP_STEP_NAMES.GTM_CONVERSION_SETUP,
    provider: 'gtm',
    service: 'gtmConversionSetupService',
    artifactTypes: ['gtm_tag', 'gtm_trigger', 'gtm_variable', 'gtm_container'],
    idempotencyKey: (ctx) => gtmConversionIdempotencyKey(ctx.setupRunId, ctx.logicalKey),
  },
  {
    stepName: SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
    provider: 'google_ads',
    service: 'adsAutoCampaignService',
    artifactTypes: [
      'ads_campaign_budget',
      'ads_campaign',
      'ads_campaign_criterion',
      'ads_ad_group',
      'ads_keyword',
      'ads_ad',
      'ads_custom_conversion_goal',
      'ads_conversion_goal_campaign_config',
      'ads_conversion_link',
    ],
    idempotencyKey: (ctx) => adsCampaignIdempotencyKey(ctx.setupRunId, ctx.logicalKey),
  },
  {
    stepName: SETUP_STEP_NAMES.ADS_CONVERSION_CATALOG,
    provider: 'google_ads',
    service: 'adsConversionCatalogService',
    artifactTypes: ['ads_conversion_action'],
    idempotencyKey: (ctx) => adsConversionCatalogIdempotencyKey(ctx.setupRunId, ctx.logicalCategory),
    readOnlyExternal: true,
  },
  {
    stepName: SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS,
    provider: 'google_ads',
    service: 'adsConversionActionManagementService',
    artifactTypes: ['ads_conversion_action_created'],
    idempotencyKey: (ctx) => adsConversionActionCreationIdempotencyKey(ctx.setupRunId, ctx.slot),
  },
]);

module.exports = {
  gtmConversionIdempotencyKey,
  adsCampaignIdempotencyKey,
  adsConversionCatalogIdempotencyKey,
  adsConversionActionCreationIdempotencyKey,
  gtmProvisioningIdempotencyKey,
  adsProvisioningIdempotencyKey,
  PROVIDER_MUTATION_CONTRACT,
};
