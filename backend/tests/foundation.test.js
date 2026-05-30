'use strict';

const mongoose = require('mongoose');
const models = require('../models');
const enums = require('../constants/enums');
const { SETUP_STEP_NAMES, SETUP_WORKFLOW_TERMINALS, SETUP_RUN_WORKFLOW_ACTIVITIES, SETUP_RUN_PATCH_STATUS } = require('../constants/setupWorkflow');

/** V1 core models from mvp_implementation_plan.md → Database Architecture Strategy. */
const CORE_MODEL_NAMES = Object.freeze([
  'User',
  'BusinessContext',
  'SetupRun',
  'SetupStepExecution',
  'IntegrationConnection',
  'IntegrationProvisioningRequest',
  'ProviderSnapshot',
  'IntegrationArtifact',
  'AuditReport',
  'CampaignPlan',
]);

/** Tenant-scoped collections — every document must carry businessId. */
const TENANT_SCOPED_MODELS = Object.freeze([
  'BusinessContext',
  'SetupRun',
  'SetupStepExecution',
  'IntegrationConnection',
  'IntegrationProvisioningRequest',
  'ProviderSnapshot',
  'IntegrationArtifact',
  'AuditReport',
  'CampaignPlan',
  'ScrapeRun',
]);

function schemaPathRequired(modelName, pathName) {
  const schema = mongoose.model(modelName).schema;
  const path = schema.path(pathName);
  expect(path).toBeTruthy();
  expect(path.isRequired).toBe(true);
}

describe('foundation — models, enums, tenant isolation', () => {
  it('exports all V1 core models', () => {
    for (const name of CORE_MODEL_NAMES) {
      expect(models[name]).toBeDefined();
      expect(mongoose.model(name)).toBeDefined();
    }
  });

  it('requires businessId on tenant-scoped models', () => {
    for (const name of TENANT_SCOPED_MODELS) {
      schemaPathRequired(name, 'businessId');
    }
  });

  it('SetupStepExecution has unique compound index on setupRunId + stepName', () => {
    const indexes = mongoose.model('SetupStepExecution').schema.indexes();
    const compound = indexes.find(
      ([fields]) => fields.setupRunId === 1 && fields.stepName === 1
    );
    expect(compound).toBeTruthy();
    expect(compound[1]?.unique).toBe(true);
  });

  it('centralizes provider and workflow enums', () => {
    expect(enums.PROVIDERS).toEqual(['gbp', 'gtm', 'google_ads']);
    expect(enums.CONNECTION_HEALTH).toContain('provisioning_required');
    expect(enums.SETUP_RUN_STATUS).toContain('RUNNING');
    expect(enums.SETUP_RUN_STATUS).toContain('SUCCEEDED');
    expect(enums.SETUP_RUN_STATUS).toContain('GTM_PROVISIONING_REQUIRED');
    expect(enums.SETUP_RUN_STATUS).toContain('ADS_PROVISIONED');
    expect(enums.STEP_EXECUTION_STATUS).toContain('success');
    expect(enums.SNAPSHOT_TYPES).toContain('gbp_profile_read');
    expect(enums.ARTIFACT_TYPES).toContain('gtm_account');
    expect(enums.ARTIFACT_TYPES).toContain('gtm_workspace');
    expect(enums.ARTIFACT_TYPES).toContain('ads_manager_link');
    expect(enums.ARTIFACT_TYPES).toContain('ads_campaign');
    expect(enums.ARTIFACT_TYPES).toContain('ads_campaign_budget');
    expect(enums.ARTIFACT_TYPES).toContain('ads_conversion_link');
    expect(enums.PROVISIONING_REASON_CODES).toContain('GBP_NO_ACCOUNTS');
    expect(enums.PROVISIONING_REASON_CODES).toContain('GBP_NO_LOCATIONS');
  });

  it('defines provisioning workflow step names and patch statuses', () => {
    expect(SETUP_STEP_NAMES.DISCOVER_PROVIDER_RESOURCES).toBe('discover_provider_resources');
    expect(SETUP_STEP_NAMES.CHECK_PROVISIONING_APPROVAL).toBe('check_provisioning_approval');
    expect(SETUP_STEP_NAMES.PROVISION_GTM_RESOURCES).toBe('provision_gtm_resources');
    expect(SETUP_STEP_NAMES.PROVISION_GOOGLE_ADS_CUSTOMER).toBe('provision_google_ads_customer');
    expect(SETUP_RUN_PATCH_STATUS.GTM_PROVISIONING_REQUIRED).toBe('GTM_PROVISIONING_REQUIRED');
    expect(SETUP_RUN_PATCH_STATUS.ADS_PROVISIONED).toBe('ADS_PROVISIONED');
  });

  it('defines stable setup step names for workflow activities', () => {
    expect(SETUP_STEP_NAMES.LOAD_CONTEXT).toBe('load_setup_context');
    expect(SETUP_STEP_NAMES.CHECK_GTM_CONNECTION).toBe('check_gtm_connection');
    expect(SETUP_STEP_NAMES.GBP_AUDIT).toBe('gbp_audit');
    expect(SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION).toBe('structural_verification');
    expect(SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION).toBe('ads_campaign_creation');
  });

  it('defines stable workflow terminal outcomes', () => {
    expect(SETUP_WORKFLOW_TERMINALS.INVALID).toBe('invalid');
    expect(SETUP_WORKFLOW_TERMINALS.FAILED).toBe('failed');
    expect(SETUP_WORKFLOW_TERMINALS.MANUAL_REVIEW).toBe('manual_review');
    expect(SETUP_WORKFLOW_TERMINALS.NEEDS_TRACKING_FIX).toBe('needs_tracking_fix');
    expect(SETUP_WORKFLOW_TERMINALS.GBP_BLOCKED).toBe('gbp_blocked');
    expect(SETUP_WORKFLOW_TERMINALS.GTM_PROVISIONING_REQUIRED).toBe('gtm_provisioning_required');
    expect(SETUP_WORKFLOW_TERMINALS.ADS_PROVISIONING_REQUIRED).toBe('ads_provisioning_required');
    expect(SETUP_WORKFLOW_TERMINALS.SUCCEEDED).toBe('succeeded');
  });

  it('lists all setupRunWorkflow activities for worker registration', () => {
    const activities = require('../activities');
    for (const name of SETUP_RUN_WORKFLOW_ACTIVITIES) {
      expect(typeof activities[name]).toBe('function');
    }
  });
});
