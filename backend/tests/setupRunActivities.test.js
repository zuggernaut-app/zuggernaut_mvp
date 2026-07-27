'use strict';

jest.mock('../services/capabilities', () => {
  const actual = jest.requireActual('../services/capabilities');
  return {
  ...actual,
  runGbpReadOnlyAudit: jest.fn().mockResolvedValue({
    findings: { present: ['Business name'], missing: [], needsAttention: [] },
    summary: { presentCount: 1, missingCount: 0, needsAttentionCount: 0 },
    source: 'gbp_api_mock',
  }),
  fetchAndPersistConversionCatalog: jest.fn().mockResolvedValue({
    selectedIds: ['1001'],
    summary: {
      primaryGoal: 'calls',
      source: 'google_ads_api_mock',
      totalInCatalog: 2,
      callCount: 1,
      formCount: 1,
      selectedCount: 1,
      selectedCategories: ['call'],
    },
    source: 'google_ads_api_mock',
  }),
  AdsCatalogPreconditionError: class AdsCatalogPreconditionError extends Error {
    constructor(m, code = 'ADS_CATALOG_PRECONDITION') {
      super(m);
      this.code = code;
    }
  },
  runGtmConversionSetup: jest.fn().mockResolvedValue({
    summary: {
      templateVersion: 1,
      tagsCreated: 1,
      triggersCreated: 2,
      variablesCreated: 2,
      reusedArtifacts: 0,
      publishedVersion: 'accounts/mock-account/containers/mock-container/workspaces/mock-workspace/versions/zug-mock',
      source: 'gtm_api_mock',
    },
    source: 'gtm_api_mock',
  }),
  GtmProviderPreconditionError: class GtmProviderPreconditionError extends Error {
    constructor(m, code = 'GTM_PROVIDER_PRECONDITION') {
      super(m);
      this.code = code;
    }
  },
  runStructuralVerification: jest.fn().mockResolvedValue({
    result: 'pass',
    evidence: {},
    summary: 'ok',
  }),
  createAdsAutoCampaign: jest.fn().mockResolvedValue({
    idempotent: false,
    source: 'google_ads_api_mock',
    summary: {
      campaignCreated: true,
      adGroupCreated: true,
      adCreated: true,
      reusedArtifacts: 0,
      campaignExternalId: 'customers/123/campaigns/zug-campaign-mock',
      adGroupExternalId: 'customers/123/adGroups/zug-adgroup-mock',
      adExternalId: 'customers/123/adGroupAds/zug-ad-mock',
      budgetExternalId: 'customers/123/campaignBudgets/zug-budget-mock',
      conversionLinkCount: 1,
      source: 'google_ads_api_mock',
    },
  }),
  AdsProviderPreconditionError: class AdsProviderPreconditionError extends Error {
    constructor(m, code = 'ADS_PROVIDER_PRECONDITION', _googleAdsDetails = undefined, meta = undefined) {
      super(m);
      this.code = code;
      if (meta && typeof meta === 'object') {
        if (Array.isArray(meta.issues)) {
          this.issues = meta.issues;
        }
        if (meta.bucketValidation) {
          this.bucketValidation = meta.bucketValidation;
        }
        if (meta.field) {
          this.field = meta.field;
        }
      }
    }
  },
  ensureSetupProvisioningRequest: jest.fn(),
  checkSetupProvisioningApproval: jest.fn(),
  executeProvisioningRequest: jest.fn(),
  ProvisioningServiceError: class ProvisioningServiceError extends Error {
    constructor(m, code = 'PROVISIONING_ERROR') {
      super(m);
      this.code = code;
    }
  },
  GtmProvisioningError: class GtmProvisioningError extends Error {
    constructor(m, code = 'GTM_PROVISIONING_ERROR') {
      super(m);
      this.code = code;
    }
  },
  AdsProvisioningError: class AdsProvisioningError extends Error {
    constructor(m, code = 'ADS_PROVISIONING_ERROR') {
      super(m);
      this.code = code;
    }
  },
  };
});

const mongoose = require('mongoose');
const { ApplicationFailure } = require('@temporalio/activity');
const capabilities = require('../services/capabilities');
const { SETUP_STEP_NAMES } = require('../constants/setupWorkflow');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { allScopesForProvider } = require('../constants/googleOAuth');
const { connectGoogleIntegrations } = require('./fixtures/setupRunFixtures');
const {
  loadSetupContextActivity,
  checkGbpPreconditionsActivity,
  checkGtmPreconditionsActivity,
  checkGoogleAdsConnectionActivity,
  discoverGoogleAdsCustomersActivity,
  ensureGoogleAdsProvisioningApprovalActivity,
  checkGoogleAdsPreconditionsActivity,
  checkProvisioningApprovalActivity,
  provisionGtmResourcesActivity,
  provisionGoogleAdsCustomerActivity,
  runGbpAuditActivity,
  manageAdsConversionActionsActivity,
  fetchAdsConversionCatalogActivity,
  runGtmConversionSetupActivity,
  runStructuralVerificationActivity,
  createAdsCampaignActivity,
} = require('../activities/setupRunActivities');

const { buildMinimalAdsReadyBusinessContext } = require('../services/capabilities/businessContextAdsReadinessService');

async function seedRun(email) {
  const User = mongoose.model('User');
  const BusinessContext = mongoose.model('BusinessContext');
  const SetupRun = mongoose.model('SetupRun');

  const user = await User.create({ email });
  const bc = await BusinessContext.create({
    userId: user._id,
    confirmedAt: new Date(),
    ...buildMinimalAdsReadyBusinessContext(),
  });
  const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });
  return { bc, run };
}

describe('setupRun activities (with mocked capabilities)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    capabilities.runGbpReadOnlyAudit.mockResolvedValue({
      findings: { present: ['Business name'], missing: [], needsAttention: [] },
      summary: { presentCount: 1, missingCount: 0, needsAttentionCount: 0 },
      source: 'gbp_api_mock',
    });
    capabilities.fetchAndPersistConversionCatalog.mockResolvedValue({
      selectedIds: ['1001'],
      summary: {
        primaryGoal: 'calls',
        source: 'google_ads_api_mock',
        totalInCatalog: 2,
        callCount: 1,
        formCount: 1,
        selectedCount: 1,
        selectedCategories: ['call'],
      },
      source: 'google_ads_api_mock',
    });
    capabilities.runGtmConversionSetup.mockResolvedValue({
      summary: {
        templateVersion: 1,
        tagsCreated: 1,
        triggersCreated: 2,
        variablesCreated: 2,
        reusedArtifacts: 0,
        publishedVersion: 'accounts/mock-account/containers/mock-container/workspaces/mock-workspace/versions/zug-mock',
        source: 'gtm_api_mock',
      },
      source: 'gtm_api_mock',
    });
    capabilities.runStructuralVerification.mockResolvedValue({
      result: 'pass',
      evidence: {},
      summary: 'ok',
    });
    capabilities.createAdsAutoCampaign.mockResolvedValue({
      idempotent: false,
      source: 'google_ads_api_mock',
      summary: {
        campaignCreated: true,
        adGroupCreated: true,
        adCreated: true,
        reusedArtifacts: 0,
        campaignExternalId: 'customers/123/campaigns/zug-campaign-mock',
        adGroupExternalId: 'customers/123/adGroups/zug-adgroup-mock',
        adExternalId: 'customers/123/adGroupAds/zug-ad-mock',
        budgetExternalId: 'customers/123/campaignBudgets/zug-budget-mock',
        conversionLinkCount: 1,
        source: 'google_ads_api_mock',
      },
    });
    capabilities.ensureSetupProvisioningRequest.mockResolvedValue({
      request: { id: 'req-mock-1', status: 'pending_approval' },
      created: true,
    });
    capabilities.checkSetupProvisioningApproval.mockResolvedValue({
      outcome: 'pending_approval',
      provisioningRequestId: 'req-mock-1',
      request: { id: 'req-mock-1', status: 'pending_approval' },
    });
    capabilities.executeProvisioningRequest.mockResolvedValue({
      providerIdentifiers: { accountId: 'acc-1', containerId: 'cont-1', workspaceId: 'ws-1' },
      connectionHealth: 'connected',
    });
  });

  it('loadSetupContextActivity returns workflow-safe fields and marks step success', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');

    const user = await User.create({ email: 'act@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      ...buildMinimalAdsReadyBusinessContext({
        websiteUrl: 'https://shop.example',
        goals: { primary: 'leads' },
      }),
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'USER_INPUT_COLLECTED' });

    const out = await loadSetupContextActivity({ setupRunId: run._id.toString() });
    expect(out.outcome).toBe('ok');
    expect(out.businessId).toBe(bc.businessId.toString());
    expect(out.goals).toEqual({ primary: 'leads' });
    expect(out).not.toHaveProperty('accessToken');
    expect(out.connections).toBeDefined();
    expect(out.connections.gtm.ready).toBe(false);

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.LOAD_CONTEXT,
    }).lean();
    expect(step.status).toBe('success');

    const updatedRun = await SetupRun.findById(run._id).lean();
    expect(updatedRun.status).toBe('RUNNING');
  });

  it('loadSetupContextActivity persists conversionStrategy from goals', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');

    const user = await User.create({ email: 'act-strategy@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      ...buildMinimalAdsReadyBusinessContext({
        goals: { primary: 'calls' },
      }),
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'USER_INPUT_COLLECTED' });

    const out = await loadSetupContextActivity({ setupRunId: run._id.toString() });
    expect(out.outcome).toBe('ok');

    const updated = await BusinessContext.findOne({ businessId: bc.businessId }).lean();
    expect(updated.conversionStrategy).toBeDefined();
    expect(updated.conversionStrategy.resolvedPrimaryGoal).toBe('calls');
    expect(updated.conversionStrategy.derivedFrom).toBe('user_confirmed_goals');
    expect(updated.conversionStrategy.requiredSlots).toHaveLength(1);
    expect(updated.conversionStrategy.requiredSlots[0].resolution).toBe('pending');
  });

  it('loadSetupContextActivity fails when BusinessContext is not ads-ready', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');

    const user = await User.create({ email: 'act-strategy-default@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      businessName: 'Incomplete Co',
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'USER_INPUT_COLLECTED' });

    const out = await loadSetupContextActivity({ setupRunId: run._id.toString() });
    expect(out.outcome).toBe('failed');
    expect(out.issues).toBeDefined();

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.LOAD_CONTEXT,
    }).lean();
    expect(step.status).toBe('failed');
  });

  it('loadSetupContextActivity still succeeds when conversion strategy derivation fails', async () => {
    const BusinessContext = mongoose.model('BusinessContext');
    const managementService = require('../services/capabilities/adsConversionActionManagementService');
    const deriveSpy = jest
      .spyOn(managementService, 'deriveConversionStrategy')
      .mockImplementation(() => {
        throw new Error('derivation boom');
      });

    const { bc, run } = await seedRun('act-strategy-fail@test.com');

    const out = await loadSetupContextActivity({ setupRunId: run._id.toString() });
    expect(out.outcome).toBe('ok');

    const updated = await BusinessContext.findOne({ businessId: bc.businessId }).lean();
    expect(updated.conversionStrategy).toBeUndefined();

    deriveSpy.mockRestore();
  });

  it('loadSetupContextActivity marks step failed when BusinessContext missing', async () => {
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const { bc, run } = await seedRun('act-fail-bc@test.com');
    await BusinessContext.deleteOne({ businessId: bc.businessId });

    const out = await loadSetupContextActivity({ setupRunId: run._id.toString() });
    expect(out.outcome).toBe('failed');

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.LOAD_CONTEXT,
    }).lean();
    expect(step.status).toBe('failed');
    expect(step.lastErrorSummary).toContain('BusinessContext');

    const updatedRun = await SetupRun.findById(run._id).lean();
    expect(updatedRun.status).toBe('FAILED');
  });

  it('checkGtmPreconditionsActivity skips when GTM is not connected', async () => {
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const { bc, run } = await seedRun('act2@test.com');

    const out = await checkGtmPreconditionsActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
    });
    expect(out.outcome).toBe('not_ready');
    expect(out.ready).toBe(false);

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.CHECK_GTM_CONNECTION,
    }).lean();
    expect(step.status).toBe('skipped');
  });

  it('checkGtmPreconditionsActivity skips when GTM OAuth is connected but not setup-ready', async () => {
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { bc, run } = await seedRun('act-gtm-prov@test.com');
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'gtm',
      connectionHealth: 'provisioning_required',
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: allScopesForProvider('gtm'),
      providerIdentifiers: { discoveryReason: 'GTM_PROVISIONING_REQUIRED' },
    });

    const out = await checkGtmPreconditionsActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
    });
    expect(out.outcome).toBe('gtm_provisioning_required');
    expect(out.reason).toBe('provisioning_required');
    expect(capabilities.ensureSetupProvisioningRequest).not.toHaveBeenCalled();

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.CHECK_GTM_CONNECTION,
    }).lean();
    expect(step.status).toBe('success');
  });

  it('discoverGoogleAdsCustomersActivity returns ok when saved customer is still accessible', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { bc, run } = await seedRun('act-ads-saved@test.com');
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: allScopesForProvider('google_ads'),
      providerIdentifiers: {
        customerId: '7809414862',
        accessibleCustomerIds: ['7809414862'],
        selectionRequired: false,
        selectedAt: new Date().toISOString(),
        selectionSource: 'product_setup',
      },
    });
    process.env.GOOGLE_ADS_API_MOCK = 'false';
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
    const axios = require('axios');
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: { resourceNames: ['customers/7809414862', 'customers/2940178860'] },
    });

    const out = await discoverGoogleAdsCustomersActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
    });

    expect(out.outcome).toBe('ok');
    expect(out.customerId).toBe('7809414862');

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.DISCOVER_GOOGLE_ADS_CUSTOMERS,
    }).lean();
    expect(step.status).toBe('success');
  });

  it('discoverGoogleAdsCustomersActivity returns manual_review when selection is still required', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { bc, run } = await seedRun('act-ads-select@test.com');
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'selection_required',
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: allScopesForProvider('google_ads'),
      providerIdentifiers: { selectionRequired: true },
    });
    process.env.GOOGLE_ADS_API_MOCK = 'false';
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
    const axios = require('axios');
    jest.spyOn(axios, 'get').mockResolvedValueOnce({
      status: 200,
      data: { resourceNames: ['customers/1234567890'] },
    });

    const out = await discoverGoogleAdsCustomersActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
    });

    expect(out.outcome).toBe('manual_review');
    expect(out.errorCode).toBe('ADS_CUSTOMER_SELECTION_REQUIRED');

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.status).toBe('SETUP_NEEDS_MANUAL_REVIEW');
  });

  it('discoverGoogleAdsCustomersActivity returns provisioning_required when no accessible customers and MCC configured', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { bc, run } = await seedRun('act-ads-prov@test.com');
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'provisioning_required',
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: allScopesForProvider('google_ads'),
      providerIdentifiers: { discoveryReason: 'ADS_CUSTOMER_NOT_FOUND' },
    });
    process.env.GOOGLE_ADS_API_MOCK = 'false';
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = '3462198684';
    const axios = require('axios');
    jest.spyOn(axios, 'get').mockResolvedValueOnce({ status: 200, data: { resourceNames: [] } });

    const out = await discoverGoogleAdsCustomersActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
    });
    expect(out.outcome).toBe('ads_provisioning_required');

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.status).toBe('ADS_PROVISIONING_REQUIRED');

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.DISCOVER_GOOGLE_ADS_CUSTOMERS,
    }).lean();
    expect(step.status).toBe('skipped');
  });

  it('discoverGoogleAdsCustomersActivity returns customer_not_found when no accessible customers and no MCC', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { bc, run } = await seedRun('act-ads-not-found@test.com');
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: allScopesForProvider('google_ads'),
      providerIdentifiers: { discoveryReason: 'ADS_CUSTOMER_NOT_FOUND' },
    });
    process.env.GOOGLE_ADS_API_MOCK = 'false';
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
    delete process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    const axios = require('axios');
    jest.spyOn(axios, 'get').mockResolvedValueOnce({ status: 200, data: { resourceNames: [] } });

    const out = await discoverGoogleAdsCustomersActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
    });
    expect(out.outcome).toBe('manual_review');
    expect(out.errorCode).toBe('ADS_CUSTOMER_NOT_FOUND');

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.status).toBe('SETUP_NEEDS_MANUAL_REVIEW');

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.DISCOVER_GOOGLE_ADS_CUSTOMERS,
    }).lean();
    expect(step.status).toBe('skipped');
  });

  it('checkProvisioningApprovalActivity returns pending_approval', async () => {
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const { bc, run } = await seedRun('act-prov-approval@test.com');

    const out = await checkProvisioningApprovalActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
      provider: 'gtm',
    });
    expect(out.outcome).toBe('pending_approval');
    expect(out.provisioningRequestId).toBe('req-mock-1');

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.CHECK_PROVISIONING_APPROVAL,
    }).lean();
    expect(step.status).toBe('skipped');
  });

  it('checkProvisioningApprovalActivity returns approved when request is approved', async () => {
    capabilities.checkSetupProvisioningApproval.mockResolvedValue({
      outcome: 'approved',
      provisioningRequestId: 'req-approved-1',
      request: { id: 'req-approved-1', status: 'approved' },
    });
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const { bc, run } = await seedRun('act-prov-approved@test.com');

    const out = await checkProvisioningApprovalActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
      provider: 'google_ads',
    });
    expect(out.outcome).toBe('approved');
    expect(out.provisioningRequestId).toBe('req-approved-1');

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.CHECK_PROVISIONING_APPROVAL,
    }).lean();
    expect(step.status).toBe('success');
  });

  it('checkProvisioningApprovalActivity returns manual_review when request failed', async () => {
    capabilities.checkSetupProvisioningApproval.mockResolvedValue({
      outcome: 'terminal_failure',
      provisioningRequestId: 'req-failed-1',
      request: { id: 'req-failed-1', status: 'failed', errorCode: 'ADS_MCC_PERMISSION_DENIED' },
    });
    const SetupRun = mongoose.model('SetupRun');
    const { bc, run } = await seedRun('act-prov-failed@test.com');

    const out = await checkProvisioningApprovalActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
      provider: 'google_ads',
    });
    expect(out.outcome).toBe('manual_review');

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.status).toBe('SETUP_NEEDS_MANUAL_REVIEW');
  });

  it('provisionGtmResourcesActivity marks success and patches GTM_PROVISIONED', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const { bc, run } = await seedRun('act-prov-gtm@test.com');

    const out = await provisionGtmResourcesActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
      provisioningRequestId: 'req-mock-1',
    });
    expect(out.outcome).toBe('ok');
    expect(capabilities.executeProvisioningRequest).toHaveBeenCalled();

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.status).toBe('GTM_PROVISIONED');
    expect(updated.meta.gtmProvisioning).toBe('provisioned');

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.PROVISION_GTM_RESOURCES,
    }).lean();
    expect(step.status).toBe('success');
  });

  it('provisionGoogleAdsCustomerActivity marks success and patches ADS_PROVISIONED', async () => {
    capabilities.executeProvisioningRequest.mockResolvedValue({
      providerIdentifiers: { customerId: 'cust-123' },
      connectionHealth: 'connected',
    });
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const { bc, run } = await seedRun('act-prov-ads@test.com');

    const out = await provisionGoogleAdsCustomerActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
      provisioningRequestId: 'req-mock-ads',
    });
    expect(out.outcome).toBe('ok');
    expect(capabilities.executeProvisioningRequest).toHaveBeenCalled();
    expect(capabilities.executeProvisioningRequest.mock.calls[0][0].requestId).toBe('req-mock-ads');

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.status).toBe('ADS_PROVISIONED');
    expect(updated.meta.googleAdsProvisioning).toBe('provisioned');

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.PROVISION_GOOGLE_ADS_CUSTOMER,
    }).lean();
    expect(step.status).toBe('success');
  });

  it('checkGbpPreconditionsActivity does not block when GBP missing', async () => {
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const { bc, run } = await seedRun('act-gbp@test.com');

    const out = await checkGbpPreconditionsActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
    });
    expect(out.ready).toBe(false);
    expect(out.outcome).toBe('not_ready');

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.CHECK_GBP_CONNECTION,
    }).lean();
    expect(step.status).toBe('success');
  });

  it('runGbpAuditActivity skips when GBP not connected', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const { bc, run } = await seedRun('act-gbp-skip@test.com');

    const out = await runGbpAuditActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
    });
    expect(out.outcome).toBe('skipped');
    expect(capabilities.runGbpReadOnlyAudit).not.toHaveBeenCalled();

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.GBP_AUDIT,
    }).lean();
    expect(step.status).toBe('skipped');

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.meta.gbpAudit).toBe('skipped');
  });

  it('runGbpAuditActivity persists audit via capability service when GBP connected', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { bc, run } = await seedRun('act3@test.com');
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'gbp',
      connectionHealth: 'connected',
      accessTokenEnc: 'x',
      refreshTokenEnc: 'y',
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: ['https://www.googleapis.com/auth/business.manage'],
    });

    const out = await runGbpAuditActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
    });
    expect(out.outcome).toBe('ok');
    expect(capabilities.runGbpReadOnlyAudit).toHaveBeenCalled();

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.GBP_AUDIT,
    }).lean();
    expect(step.status).toBe('success');
    expect(step.details?.summary?.presentCount).toBe(1);

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.status).toBe('GBP_AUDIT_COMPLETE');
  });

  it('runGbpAuditActivity skips with guidance when GBP profile is missing', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { bc, run } = await seedRun('act-gbp-guidance@test.com');
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'gbp',
      connectionHealth: 'connected',
      accessTokenEnc: 'x',
      refreshTokenEnc: 'y',
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: ['https://www.googleapis.com/auth/business.manage'],
    });

    const guidance = {
      code: 'GBP_NO_ACCOUNTS',
      title: 'No Google Business Profile account found',
      message: 'Connect a Google account that has access to your Business Profile, or create one in Google Business Profile.',
      blocking: false,
    };
    capabilities.runGbpReadOnlyAudit.mockResolvedValueOnce({
      skipped: true,
      reason: 'GBP_NO_ACCOUNTS',
      guidance,
      summary: { presentCount: 0, missingCount: 0, needsAttentionCount: 1 },
      source: 'gbp_missing',
      blocking: false,
    });

    const out = await runGbpAuditActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
    });
    expect(out.outcome).toBe('skipped');
    expect(out.reason).toBe('GBP_NO_ACCOUNTS');
    expect(out.blocking).toBe(false);
    expect(out.guidance).toEqual(guidance);

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.GBP_AUDIT,
    }).lean();
    expect(step.status).toBe('skipped');
    expect(step.details?.reason).toBe('GBP_NO_ACCOUNTS');
    expect(step.details?.blocking).toBe(false);

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.meta.gbpAudit).toBe('guidance');
    expect(updated.meta.gbpGuidance).toEqual(guidance);
    expect(updated.status).toBe('GBP_AUDIT_COMPLETE');
  });

  describe('manageAdsConversionActionsActivity', () => {
    const IntegrationConnection = () => mongoose.model('IntegrationConnection');

    beforeEach(() => {
      process.env.GOOGLE_ADS_API_MOCK = 'true';
      delete process.env.GOOGLE_ADS_CONVERSION_ACTION_CREATION_ENABLED;
    });

    async function seedAdsRun(email, opts = {}) {
      const User = mongoose.model('User');
      const BusinessContext = mongoose.model('BusinessContext');
      const SetupRun = mongoose.model('SetupRun');

      const user = await User.create({ email });
      const bc = await BusinessContext.create({
        userId: user._id,
        confirmedAt: new Date(),
        goals: 'goals' in opts ? opts.goals : { primary: 'both' },
      });
      const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });

      await IntegrationConnection().create({
        businessId: bc.businessId,
        provider: 'google_ads',
        connectionHealth: 'connected',
        accessTokenEnc: encryptToken('token'),
        refreshTokenEnc: encryptToken('refresh'),
        tokenExpiryAt: new Date(Date.now() + 3600_000),
        scopes: allScopesForProvider('google_ads'),
        providerIdentifiers: {
          customerId: '1234567890',
          mockConversionActions: opts.mockConversionActions,
        },
      });

      return { bc, run };
    }

    it('marks success when all slots are filled from catalog', async () => {
      const SetupStepExecution = mongoose.model('SetupStepExecution');
      const BusinessContext = mongoose.model('BusinessContext');
      const SetupRun = mongoose.model('SetupRun');
      const { bc, run } = await seedAdsRun('act-manage-ok@test.com');

      const out = await manageAdsConversionActionsActivity({
        setupRunId: run._id.toString(),
        businessId: bc.businessId.toString(),
      });

      expect(out.outcome).toBe('ok');
      expect(out.slotsResolved).toBe(2);
      expect(out.reused).toBe(2);
      expect(out.created).toBe(0);

      const step = await SetupStepExecution.findOne({
        setupRunId: run._id,
        stepName: SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS,
      }).lean();
      expect(step.status).toBe('success');

      const updatedBc = await BusinessContext.findOne({ businessId: bc.businessId }).lean();
      expect(updatedBc.conversionStrategy.requiredSlots).toHaveLength(2);
      expect(
        updatedBc.conversionStrategy.requiredSlots.every((slot) => slot.resolution === 'existing')
      ).toBe(true);

      const updatedRun = await SetupRun.findById(run._id).lean();
      expect(updatedRun.meta.conversionActionManagement).toBe('ok');
    });

    it('marks manual review when business goals are missing', async () => {
      const SetupRun = mongoose.model('SetupRun');
      const SetupStepExecution = mongoose.model('SetupStepExecution');
      const { bc, run } = await seedAdsRun('act-manage-no-goals@test.com', { goals: null });

      const out = await manageAdsConversionActionsActivity({
        setupRunId: run._id.toString(),
        businessId: bc.businessId.toString(),
      });

      expect(out.outcome).toBe('manual_review');
      expect(out.errorCode).toBe('CONVERSION_STRATEGY_MISSING_GOALS');

      const step = await SetupStepExecution.findOne({
        setupRunId: run._id,
        stepName: SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS,
      }).lean();
      expect(step.status).toBe('failed');

      const updated = await SetupRun.findById(run._id).lean();
      expect(updated.status).toBe('SETUP_NEEDS_MANUAL_REVIEW');
    });

    it('marks manual review when creation is disabled and a required slot is missing', async () => {
      const SetupRun = mongoose.model('SetupRun');
      const BusinessContext = mongoose.model('BusinessContext');
      const { bc, run } = await seedAdsRun('act-manage-flag-off@test.com', {
        mockConversionActions: [
          {
            id: '1002',
            name: 'Website form submit',
            category: 'SUBMIT_LEAD_FORM',
            status: 'ENABLED',
            type: 'WEBPAGE',
            includeInConversionsMetric: true,
          },
        ],
      });

      const out = await manageAdsConversionActionsActivity({
        setupRunId: run._id.toString(),
        businessId: bc.businessId.toString(),
      });

      expect(out.outcome).toBe('manual_review');

      const updatedBc = await BusinessContext.findOne({ businessId: bc.businessId }).lean();
      const callSlot = updatedBc.conversionStrategy.requiredSlots.find((slot) => slot.slot === 'call');
      const formSlot = updatedBc.conversionStrategy.requiredSlots.find((slot) => slot.slot === 'form');
      expect(callSlot.resolution).toBe('pending');
      expect(formSlot.resolution).toBe('existing');

      const updated = await SetupRun.findById(run._id).lean();
      expect(updated.status).toBe('SETUP_NEEDS_MANUAL_REVIEW');
    });

    it('creates missing actions when creation flag is enabled', async () => {
      process.env.GOOGLE_ADS_CONVERSION_ACTION_CREATION_ENABLED = 'true';
      const IntegrationArtifact = mongoose.model('IntegrationArtifact');
      const BusinessContext = mongoose.model('BusinessContext');
      const { bc, run } = await seedAdsRun('act-manage-create@test.com', {
        mockConversionActions: [
          {
            id: '1002',
            name: 'Website form submit',
            category: 'SUBMIT_LEAD_FORM',
            status: 'ENABLED',
            type: 'WEBPAGE',
            includeInConversionsMetric: true,
          },
        ],
      });

      const out = await manageAdsConversionActionsActivity({
        setupRunId: run._id.toString(),
        businessId: bc.businessId.toString(),
      });

      expect(out.outcome).toBe('ok');
      expect(out.created).toBe(1);
      expect(out.reused).toBe(1);

      const updatedBc = await BusinessContext.findOne({ businessId: bc.businessId }).lean();
      const callSlot = updatedBc.conversionStrategy.requiredSlots.find((slot) => slot.slot === 'call');
      expect(callSlot.resolution).toBe('create');
      expect(callSlot.externalId).toBeTruthy();

      expect(
        await IntegrationArtifact.countDocuments({
          setupRunId: run._id,
          artifactType: 'ads_conversion_action_created',
        })
      ).toBe(1);
    });
  });

  it('fetchAdsConversionCatalogActivity calls catalog service and marks success', async () => {
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const { bc, run } = await seedRun('act4@test.com');

    await fetchAdsConversionCatalogActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
    });
    expect(capabilities.fetchAndPersistConversionCatalog).toHaveBeenCalled();

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.ADS_CONVERSION_CATALOG,
    }).lean();
    expect(step.status).toBe('success');
    expect(step.details?.summary?.selectedCount).toBe(1);

    const SetupRun = mongoose.model('SetupRun');
    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.status).toBe('CONVERSION_CATALOG_READY');
  });

  it('fetchAdsConversionCatalogActivity marks failed and patches SetupRun on service error', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const { bc, run } = await seedRun('act-catalog-fail@test.com');
    capabilities.fetchAndPersistConversionCatalog.mockRejectedValue(new Error('catalog down'));

    await expect(
      fetchAdsConversionCatalogActivity({
        setupRunId: run._id.toString(),
        businessId: bc.businessId.toString(),
      })
    ).rejects.toThrow(ApplicationFailure);

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.ADS_CONVERSION_CATALOG,
    }).lean();
    expect(step.status).toBe('failed');

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.status).toBe('FAILED');
  });

  it('throws non-retryable validation error for invalid IDs', async () => {
    await expect(
      runGbpAuditActivity({ setupRunId: 'not-valid', businessId: 'also-bad' })
    ).rejects.toMatchObject({ type: 'SetupValidationError' });
  });

  it('runStructuralVerificationActivity sets SETUP_NEEDS_TRACKING_FIX on failure verdict', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const { bc, run } = await seedRun('act-verify-fail@test.com');
    capabilities.runStructuralVerification.mockResolvedValue({
      result: 'needs_tracking_fix',
      evidence: { snippetPresent: false },
      summary: 'GTM snippet not detected',
    });

    const out = await runStructuralVerificationActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
    });
    expect(out.outcome).toBe('needs_tracking_fix');

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
    }).lean();
    expect(step.status).toBe('failed');

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.status).toBe('SETUP_NEEDS_TRACKING_FIX');
  });

  it('runStructuralVerificationActivity sets GTM_SNIPPET_PENDING on snippet_pending verdict', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const { bc, run } = await seedRun('act-verify-snippet@test.com');
    capabilities.runStructuralVerification.mockResolvedValue({
      result: 'snippet_pending',
      evidence: { snippetPresent: false, missing: ['snippet'] },
      summary: 'Install GTM snippet',
    });

    const out = await runStructuralVerificationActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
    });
    expect(out.outcome).toBe('snippet_pending');

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
    }).lean();
    expect(step.status).toBe('failed');
    expect(step.details?.snippetPending).toBe(true);

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.status).toBe('GTM_SNIPPET_PENDING');
    expect(updated.meta?.supportState?.errorCode).toBe('GTM_SNIPPET_PENDING');
  });

  it('runGtmConversionSetupActivity patches GTM_SETUP_COMPLETE on success', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const { bc, run } = await seedRun('act-gtm-ok@test.com');
    await connectGoogleIntegrations(bc.businessId);

    const out = await runGtmConversionSetupActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
    });
    expect(out.outcome).toBe('ok');

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.status).toBe('GTM_SETUP_COMPLETE');
    expect(updated.meta?.gtm).toBe('setup_complete');
  });

  it('runStructuralVerificationActivity patches STRUCTURAL_VERIFIED on pass', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const { bc, run } = await seedRun('act-verify-pass@test.com');
    capabilities.runStructuralVerification.mockResolvedValue({
      result: 'pass',
      evidence: { snippetPresent: true, missing: [] },
      summary: 'Structural verification passed.',
    });

    const out = await runStructuralVerificationActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
    });
    expect(out.outcome).toBe('pass');

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.status).toBe('STRUCTURAL_VERIFIED');
  });

  it('createAdsCampaignActivity sets SUCCEEDED on success', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const { bc, run } = await seedRun('act-ads-ok@test.com');

    const out = await createAdsCampaignActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
    });
    expect(out.outcome).toBe('ok');

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
    }).lean();
    expect(step.status).toBe('success');

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.status).toBe('SUCCEEDED');
    expect(updated.meta?.ads).toBe('campaigns_recorded');
    expect(updated.meta?.adsCampaignSummary?.campaignCreated).toBe(true);
  });

  it('runGtmConversionSetupActivity skips when GTM is not connected', async () => {
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const { bc, run } = await seedRun('act-gtm-skip@test.com');

    const out = await runGtmConversionSetupActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
    });
    expect(out.outcome).toBe('skipped');

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.GTM_CONVERSION_SETUP,
    }).lean();
    expect(step.status).toBe('skipped');
  });

  it('runGtmConversionSetupActivity marks failed on precondition error', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const { bc, run } = await seedRun('act-gtm-fail@test.com');
    await connectGoogleIntegrations(bc.businessId);
    capabilities.runGtmConversionSetup.mockRejectedValue(
      new capabilities.GtmProviderPreconditionError('GTM API not enabled')
    );

    await expect(
      runGtmConversionSetupActivity({
        setupRunId: run._id.toString(),
        businessId: bc.businessId.toString(),
      })
    ).rejects.toThrow(ApplicationFailure);

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.GTM_CONVERSION_SETUP,
    }).lean();
    expect(step.status).toBe('failed');
    expect(step.details.code).toBe('GTM_PROVIDER_PRECONDITION');

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.status).toBe('FAILED');
    expect(updated.meta?.supportState?.failedStep).toBe(SETUP_STEP_NAMES.GTM_CONVERSION_SETUP);
  });

  it('createAdsCampaignActivity persists keyword bucket failure details', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const { ADS_INTENT_CODES } = require('../constants/adsCampaignIntent');
    const { bc, run } = await seedRun('act-ads-intent@test.com');
    capabilities.createAdsAutoCampaign.mockRejectedValue(
      new capabilities.AdsProviderPreconditionError(
        'Keyword text contains invalid characters or symbols.',
        ADS_INTENT_CODES.KEYWORD_INVALID_CHARS,
        undefined,
        {
          field: 'keywords[0].text',
          issues: [
            {
              code: ADS_INTENT_CODES.KEYWORD_INVALID_CHARS,
              field: 'keywords[0].text',
              message: 'Keyword text contains invalid characters or symbols.',
              bucket: 'keywords',
            },
          ],
          bucketValidation: {
            keywords: {
              status: 'fail',
              issues: [
                {
                  code: ADS_INTENT_CODES.KEYWORD_INVALID_CHARS,
                  field: 'keywords[0].text',
                  message: 'Keyword text contains invalid characters or symbols.',
                },
              ],
            },
          },
        }
      )
    );

    await expect(
      createAdsCampaignActivity({
        setupRunId: run._id.toString(),
        businessId: bc.businessId.toString(),
      })
    ).rejects.toThrow(ApplicationFailure);

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
    }).lean();
    expect(step.status).toBe('failed');
    expect(step.details.code).toBe(ADS_INTENT_CODES.KEYWORD_INVALID_CHARS);
    expect(step.details.provider).toBe('google_ads');
    expect(step.details.stepName).toBe(SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION);
    expect(step.details.message).toContain('invalid characters');
    expect(step.details.validationBucket).toBe('keywords');
    expect(step.details.field).toBe('keywords[0].text');
    expect(step.details.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ADS_INTENT_CODES.KEYWORD_INVALID_CHARS,
          field: 'keywords[0].text',
          bucket: 'keywords',
        }),
      ])
    );
    expect(step.details.bucketValidation?.keywords?.status).toBe('fail');
    expect(step.details.bucketValidation?.keywords?.issues[0]).toEqual(
      expect.objectContaining({
        code: ADS_INTENT_CODES.KEYWORD_INVALID_CHARS,
        field: 'keywords[0].text',
      })
    );
    expect(step.lastErrorSummary).toContain('invalid characters');

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.status).toBe('FAILED');
    expect(updated.lastErrorSummary).toContain('invalid characters');
  });

  it('createAdsCampaignActivity records supportState and pauses partial campaign on failure', async () => {
    process.env.GOOGLE_ADS_API_MOCK = 'true';
    process.env.GOOGLE_ADS_API_ENABLED = 'true';
    const SetupRun = mongoose.model('SetupRun');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const { seedPartialAdsCampaignArtifacts } = require('./fixtures/setupRunFixtures');
    const { bc, run } = await seedRun('act-ads-comp@test.com');
    await seedPartialAdsCampaignArtifacts(run._id, bc.businessId);
    capabilities.createAdsAutoCampaign.mockRejectedValue(
      new capabilities.AdsProviderPreconditionError('Ads mutate failed', 'GOOGLE_ADS_MUTATE_FAILED')
    );

    await expect(
      createAdsCampaignActivity({
        setupRunId: run._id.toString(),
        businessId: bc.businessId.toString(),
      })
    ).rejects.toThrow(ApplicationFailure);

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.meta?.supportState?.errorCode).toBe('GOOGLE_ADS_MUTATE_FAILED');
    expect(updated.meta?.compensation?.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'ads_campaign_pause', outcome: 'paused' }),
      ])
    );

    expect(
      await IntegrationArtifact.countDocuments({ setupRunId: run._id, artifactType: 'ads_campaign' })
    ).toBe(1);
  });

  it('checkGoogleAdsConnectionActivity marks manual review when Ads missing', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const { bc, run } = await seedRun('act-ads-pre@test.com');

    const out = await checkGoogleAdsConnectionActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
    });
    expect(out.outcome).toBe('manual_review');

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.status).toBe('SETUP_NEEDS_MANUAL_REVIEW');
    expect(updated.meta?.missingProviders).toContain('google_ads');
  });

  it('ensureGoogleAdsProvisioningApprovalActivity returns pending_approval', async () => {
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { bc, run } = await seedRun('act-ads-approval@test.com');
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'provisioning_required',
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: allScopesForProvider('google_ads'),
      providerIdentifiers: { accessibleCustomerIds: [], discoveryReason: 'ADS_PROVISIONING_REQUIRED' },
    });
    const out = await ensureGoogleAdsProvisioningApprovalActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
    });
    expect(out.outcome).toBe('pending_approval');
    expect(out.provisioningRequestId).toBeTruthy();

    const step = await SetupStepExecution.findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.ENSURE_GOOGLE_ADS_PROVISIONING_APPROVAL,
    }).lean();
    expect(step.status).toBe('skipped');
  });

  it('runStructuralVerificationActivity sets manual review on manual_review_required verdict', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const { bc, run } = await seedRun('act-verify-manual@test.com');
    capabilities.runStructuralVerification.mockResolvedValue({
      result: 'manual_review_required',
      evidence: { missing: ['website_fetch'] },
      summary: 'Cannot fetch website',
    });

    const out = await runStructuralVerificationActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
    });
    expect(out.outcome).toBe('manual_review');

    const updated = await SetupRun.findById(run._id).lean();
    expect(updated.status).toBe('SETUP_NEEDS_MANUAL_REVIEW');
  });
});
