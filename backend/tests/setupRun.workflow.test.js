'use strict';

const fs = require('fs');
const path = require('path');
const activities = require('../activities');
const {
  SETUP_WORKFLOW_TERMINALS: T,
  SETUP_RUN_WORKFLOW_ACTIVITIES,
} = require('../constants/setupWorkflow');

const mocks = {
  loadSetupContextActivity: jest.fn(),
  checkGbpPreconditionsActivity: jest.fn(),
  checkGtmPreconditionsActivity: jest.fn(),
  checkGoogleAdsConnectionActivity: jest.fn(),
  discoverGoogleAdsCustomersActivity: jest.fn(),
  ensureGoogleAdsProvisioningApprovalActivity: jest.fn(),
  assertGoogleAdsSetupReadyActivity: jest.fn(),
  checkProvisioningApprovalActivity: jest.fn(),
  provisionGtmResourcesActivity: jest.fn(),
  provisionGoogleAdsCustomerActivity: jest.fn(),
  runGbpAuditActivity: jest.fn(),
  manageAdsConversionActionsActivity: jest.fn(),
  runStructuralVerificationActivity: jest.fn(),
  fetchAdsConversionCatalogActivity: jest.fn(),
  runGtmConversionSetupActivity: jest.fn(),
  createAdsCampaignActivity: jest.fn(),
};

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: jest.fn(() => mocks),
}));

const { proxyActivities } = require('@temporalio/workflow');
const { SETUP_ACTIVITY_POLICIES } = require('../constants/setupActivityPolicies');
const { setupRunWorkflow } = require('../workflows/setupRun.workflow');

const WORKFLOW_SOURCE = fs.readFileSync(
  path.join(__dirname, '..', 'workflows', 'setupRun.workflow.js'),
  'utf8'
);

const FORBIDDEN_WORKFLOW_PATTERNS = [
  /require\s*\(\s*['"]mongoose['"]\s*\)/,
  /require\s*\(\s*['"]axios['"]\s*\)/,
  /require\s*\(\s*['"][^'"]*google[^'"]*['"]\s*\)/i,
  /Date\.now\s*\(/,
  /Math\.random\s*\(/,
  /process\.env/,
  /require\s*\(\s*['"][^'"]*\/services/,
  /require\s*\(\s*['"][^'"]*\/models/,
];

function happyPathDefaults() {
  mocks.loadSetupContextActivity.mockResolvedValue({
    outcome: 'ok',
    setupRunId: 'run1',
    businessId: 'biz1',
    websiteUrl: 'https://example.com',
    connections: {
      gtm: { ready: true },
      google_ads: { ready: true },
    },
  });
  mocks.checkGbpPreconditionsActivity.mockResolvedValue({ outcome: 'ok', ready: true });
  mocks.checkGtmPreconditionsActivity.mockResolvedValue({ outcome: 'ok', ready: true });
  mocks.checkGoogleAdsConnectionActivity.mockResolvedValue({ outcome: 'ok' });
  mocks.discoverGoogleAdsCustomersActivity.mockResolvedValue({ outcome: 'ok' });
  mocks.ensureGoogleAdsProvisioningApprovalActivity.mockResolvedValue({ outcome: 'ready' });
  mocks.assertGoogleAdsSetupReadyActivity.mockResolvedValue({ outcome: 'ok' });
  mocks.checkProvisioningApprovalActivity.mockResolvedValue({ outcome: 'ready' });
  mocks.provisionGtmResourcesActivity.mockResolvedValue({ outcome: 'ok' });
  mocks.provisionGoogleAdsCustomerActivity.mockResolvedValue({ outcome: 'ok' });
  mocks.runGbpAuditActivity.mockResolvedValue({ outcome: 'skipped' });
  mocks.manageAdsConversionActionsActivity.mockResolvedValue({
    outcome: 'ok',
    slotsResolved: 2,
    created: 0,
    reused: 2,
  });
  mocks.fetchAdsConversionCatalogActivity.mockResolvedValue({ outcome: 'ok' });
  mocks.runGtmConversionSetupActivity.mockResolvedValue({ outcome: 'ok' });
  mocks.runStructuralVerificationActivity.mockResolvedValue({ outcome: 'pass', detail: {} });
  mocks.createAdsCampaignActivity.mockResolvedValue({ outcome: 'ok' });
}

describe('setupRunWorkflow', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((fn) => fn.mockReset());
    happyPathDefaults();
  });

  it('runs activities in order on the happy path', async () => {
    await setupRunWorkflow({ setupRunId: 'run1' });

    expect(mocks.loadSetupContextActivity).toHaveBeenCalledWith({ setupRunId: 'run1' });
    expect(mocks.checkGbpPreconditionsActivity).toHaveBeenCalledWith({
      setupRunId: 'run1',
      businessId: 'biz1',
    });
    expect(mocks.checkGtmPreconditionsActivity).toHaveBeenCalledWith({
      setupRunId: 'run1',
      businessId: 'biz1',
    });
    expect(mocks.checkGoogleAdsConnectionActivity).toHaveBeenCalledWith({
      setupRunId: 'run1',
      businessId: 'biz1',
    });
    expect(mocks.discoverGoogleAdsCustomersActivity).toHaveBeenCalledWith({
      setupRunId: 'run1',
      businessId: 'biz1',
    });
    expect(mocks.runGbpAuditActivity).toHaveBeenCalledWith({
      setupRunId: 'run1',
      businessId: 'biz1',
    });
    expect(mocks.manageAdsConversionActionsActivity).toHaveBeenCalledWith({
      setupRunId: 'run1',
      businessId: 'biz1',
    });
    expect(mocks.fetchAdsConversionCatalogActivity).toHaveBeenCalledWith({
      setupRunId: 'run1',
      businessId: 'biz1',
    });
    expect(mocks.runGtmConversionSetupActivity).toHaveBeenCalledWith({
      setupRunId: 'run1',
      businessId: 'biz1',
    });
    expect(mocks.runStructuralVerificationActivity).toHaveBeenCalledWith({
      setupRunId: 'run1',
      businessId: 'biz1',
    });
    expect(mocks.createAdsCampaignActivity).toHaveBeenCalledWith({
      setupRunId: 'run1',
      businessId: 'biz1',
    });
    expect(mocks.provisionGtmResourcesActivity).not.toHaveBeenCalled();
    expect(mocks.provisionGoogleAdsCustomerActivity).not.toHaveBeenCalled();
  });

  it('returns terminal invalid when context load is invalid', async () => {
    mocks.loadSetupContextActivity.mockResolvedValue({
      outcome: T.INVALID,
      reason: 'Invalid or missing setupRunId',
      setupRunId: null,
    });

    const out = await setupRunWorkflow({ setupRunId: 'bad' });

    expect(out.terminal).toBe(T.INVALID);
    expect(mocks.checkGbpPreconditionsActivity).not.toHaveBeenCalled();
    expect(mocks.createAdsCampaignActivity).not.toHaveBeenCalled();
  });

  it('returns terminal failed when context load fails', async () => {
    mocks.loadSetupContextActivity.mockResolvedValue({
      outcome: T.FAILED,
      reason: 'SetupRun not found',
      setupRunId: 'missing',
    });

    const out = await setupRunWorkflow({ setupRunId: 'missing' });

    expect(out.terminal).toBe(T.FAILED);
    expect(mocks.checkGbpPreconditionsActivity).not.toHaveBeenCalled();
    expect(mocks.createAdsCampaignActivity).not.toHaveBeenCalled();
  });

  it('continues when GBP is not ready and skips audit', async () => {
    mocks.checkGbpPreconditionsActivity.mockResolvedValue({
      outcome: 'not_ready',
      ready: false,
      provider: 'gbp',
    });
    mocks.runGbpAuditActivity.mockResolvedValue({ outcome: 'skipped' });

    const out = await setupRunWorkflow({ setupRunId: 'run1' });

    expect(mocks.checkGtmPreconditionsActivity).toHaveBeenCalled();
    expect(mocks.runGbpAuditActivity).toHaveBeenCalled();
    expect(mocks.createAdsCampaignActivity).toHaveBeenCalled();
    expect(out.terminal).toBe(T.SUCCEEDED);
    expect(out.gbp).toEqual(expect.objectContaining({ outcome: 'skipped' }));
  });

  it('continues when GTM is optional and not setup-ready', async () => {
    mocks.checkGtmPreconditionsActivity.mockResolvedValue({
      outcome: 'not_ready',
      ready: false,
      reason: 'provisioning_required',
    });

    const out = await setupRunWorkflow({ setupRunId: 'run1' });

    expect(mocks.checkProvisioningApprovalActivity).not.toHaveBeenCalled();
    expect(mocks.provisionGtmResourcesActivity).not.toHaveBeenCalled();
    expect(mocks.runGtmConversionSetupActivity).not.toHaveBeenCalled();
    expect(mocks.checkGoogleAdsConnectionActivity).toHaveBeenCalled();
    expect(mocks.createAdsCampaignActivity).toHaveBeenCalled();
    expect(out.terminal).toBe(T.SUCCEEDED);
  });

  it('stops with gtm_provisioning_required when GTM provisioning approval is pending', async () => {
    mocks.checkGtmPreconditionsActivity
      .mockResolvedValueOnce({
        outcome: 'gtm_provisioning_required',
        ready: false,
        reason: 'provisioning_required',
      })
      .mockResolvedValueOnce({
        outcome: 'gtm_provisioning_required',
        ready: false,
        reason: 'provisioning_required',
      });
    mocks.checkProvisioningApprovalActivity.mockResolvedValue({
      outcome: 'pending_approval',
      provisioningRequestId: 'req-gtm-1',
    });

    const out = await setupRunWorkflow({ setupRunId: 'run1' });

    expect(mocks.checkProvisioningApprovalActivity).toHaveBeenCalledWith({
      setupRunId: 'run1',
      businessId: 'biz1',
      provider: 'gtm',
    });
    expect(mocks.provisionGtmResourcesActivity).not.toHaveBeenCalled();
    expect(mocks.runGbpAuditActivity).not.toHaveBeenCalled();
    expect(out.terminal).toBe(T.GTM_PROVISIONING_REQUIRED);
    expect(out.approval).toEqual(
      expect.objectContaining({
        outcome: 'pending_approval',
        provisioningRequestId: 'req-gtm-1',
      })
    );
  });

  it('provisions GTM and continues when approval exists', async () => {
    mocks.checkGtmPreconditionsActivity
      .mockResolvedValueOnce({
        outcome: 'gtm_provisioning_required',
        ready: false,
        reason: 'provisioning_required',
      })
      .mockResolvedValueOnce({
        outcome: 'gtm_provisioning_required',
        ready: false,
        reason: 'provisioning_required',
      })
      .mockResolvedValueOnce({
        outcome: 'ok',
        ready: true,
      });
    mocks.checkProvisioningApprovalActivity.mockResolvedValue({
      outcome: 'approved',
      provisioningRequestId: 'req-gtm-1',
    });

    const out = await setupRunWorkflow({ setupRunId: 'run1' });

    expect(mocks.provisionGtmResourcesActivity).toHaveBeenCalledWith({
      setupRunId: 'run1',
      businessId: 'biz1',
      provisioningRequestId: 'req-gtm-1',
    });
    expect(mocks.checkGtmPreconditionsActivity).toHaveBeenCalledTimes(3);
    expect(mocks.runGtmConversionSetupActivity).toHaveBeenCalled();
    expect(out.terminal).toBe(T.SUCCEEDED);
  });

  it('stops with ads_provisioning_required when approval is pending', async () => {
    mocks.discoverGoogleAdsCustomersActivity.mockResolvedValue({
      outcome: 'ads_provisioning_required',
    });
    mocks.ensureGoogleAdsProvisioningApprovalActivity.mockResolvedValue({
      outcome: 'pending_approval',
      provisioningRequestId: 'req-ads-1',
    });

    const out = await setupRunWorkflow({ setupRunId: 'x' });

    expect(mocks.ensureGoogleAdsProvisioningApprovalActivity).toHaveBeenCalledWith({
      setupRunId: 'run1',
      businessId: 'biz1',
    });
    expect(mocks.provisionGoogleAdsCustomerActivity).not.toHaveBeenCalled();
    expect(mocks.runGbpAuditActivity).not.toHaveBeenCalled();
    expect(out.terminal).toBe(T.ADS_PROVISIONING_REQUIRED);
  });

  it('provisions Google Ads and continues when approval exists', async () => {
    mocks.discoverGoogleAdsCustomersActivity.mockResolvedValueOnce({
      outcome: 'ads_provisioning_required',
    });
    mocks.ensureGoogleAdsProvisioningApprovalActivity.mockResolvedValue({
      outcome: 'approved',
      provisioningRequestId: 'req-ads-1',
    });
    mocks.assertGoogleAdsSetupReadyActivity.mockResolvedValue({
      outcome: 'ok',
      customerId: '1234567890',
    });

    const out = await setupRunWorkflow({ setupRunId: 'run1' });

    expect(mocks.provisionGoogleAdsCustomerActivity).toHaveBeenCalledWith({
      setupRunId: 'run1',
      businessId: 'biz1',
      provisioningRequestId: 'req-ads-1',
    });
    expect(mocks.discoverGoogleAdsCustomersActivity).toHaveBeenCalledTimes(1);
    expect(mocks.assertGoogleAdsSetupReadyActivity).toHaveBeenCalledWith({
      setupRunId: 'run1',
      businessId: 'biz1',
    });
    expect(out.terminal).toBe(T.SUCCEEDED);
  });

  it('stops with manual review when post-provision readiness check fails', async () => {
    mocks.discoverGoogleAdsCustomersActivity.mockResolvedValueOnce({
      outcome: 'ads_provisioning_required',
    });
    mocks.ensureGoogleAdsProvisioningApprovalActivity.mockResolvedValue({
      outcome: 'approved',
      provisioningRequestId: 'req-ads-1',
    });
    mocks.assertGoogleAdsSetupReadyActivity.mockResolvedValue({
      outcome: 'manual_review',
      errorCode: 'GOOGLE_ADS_IDENTIFIERS_MISSING',
    });

    const out = await setupRunWorkflow({ setupRunId: 'run1' });

    expect(mocks.provisionGoogleAdsCustomerActivity).toHaveBeenCalled();
    expect(mocks.discoverGoogleAdsCustomersActivity).toHaveBeenCalledTimes(1);
    expect(mocks.assertGoogleAdsSetupReadyActivity).toHaveBeenCalledTimes(1);
    expect(out.terminal).toBe(T.MANUAL_REVIEW);
    expect(out.pre).toEqual(
      expect.objectContaining({ errorCode: 'GOOGLE_ADS_IDENTIFIERS_MISSING' })
    );
  });

  it('continues when GTM is not connected (optional)', async () => {
    mocks.checkGtmPreconditionsActivity.mockResolvedValue({
      outcome: 'not_ready',
      ready: false,
      reason: 'missing_connection',
    });

    const out = await setupRunWorkflow({ setupRunId: 'run1' });

    expect(mocks.checkGoogleAdsConnectionActivity).toHaveBeenCalled();
    expect(mocks.runGtmConversionSetupActivity).not.toHaveBeenCalled();
    expect(mocks.createAdsCampaignActivity).toHaveBeenCalled();
    expect(out.terminal).toBe(T.SUCCEEDED);
  });

  it('stops before provider work when Google Ads connection requires manual review', async () => {
    mocks.checkGoogleAdsConnectionActivity.mockResolvedValue({
      outcome: T.MANUAL_REVIEW,
      missingProviders: ['google_ads'],
    });

    const out = await setupRunWorkflow({ setupRunId: 'x' });

    expect(mocks.runGbpAuditActivity).not.toHaveBeenCalled();
    expect(mocks.manageAdsConversionActionsActivity).not.toHaveBeenCalled();
    expect(mocks.fetchAdsConversionCatalogActivity).not.toHaveBeenCalled();
    expect(mocks.createAdsCampaignActivity).not.toHaveBeenCalled();
    expect(out.terminal).toBe(T.MANUAL_REVIEW);
  });

  it('stops with manual_review when conversion action management needs review', async () => {
    mocks.manageAdsConversionActionsActivity.mockResolvedValue({
      outcome: 'manual_review',
      message: 'Conversion action creation is disabled and required slots are unfilled.',
    });

    const out = await setupRunWorkflow({ setupRunId: 'run1' });

    expect(mocks.manageAdsConversionActionsActivity).toHaveBeenCalled();
    expect(mocks.fetchAdsConversionCatalogActivity).not.toHaveBeenCalled();
    expect(mocks.createAdsCampaignActivity).not.toHaveBeenCalled();
    expect(out.terminal).toBe(T.MANUAL_REVIEW);
    expect(out.manage).toEqual(
      expect.objectContaining({ outcome: 'manual_review' })
    );
  });

  it('stops with failed when conversion action creation fails', async () => {
    mocks.manageAdsConversionActionsActivity.mockResolvedValue({
      outcome: 'creation_failed',
      message: 'Google Ads API error',
      errorCode: 'GOOGLE_ADS_MUTATE_FAILED',
    });

    const out = await setupRunWorkflow({ setupRunId: 'run1' });

    expect(mocks.manageAdsConversionActionsActivity).toHaveBeenCalled();
    expect(mocks.fetchAdsConversionCatalogActivity).not.toHaveBeenCalled();
    expect(mocks.createAdsCampaignActivity).not.toHaveBeenCalled();
    expect(out.terminal).toBe(T.FAILED);
    expect(out.manage).toEqual(
      expect.objectContaining({ outcome: 'creation_failed' })
    );
  });

  it('returns gbp_blocked when GBP audit fails unexpectedly', async () => {
    mocks.runGbpAuditActivity.mockResolvedValue({ outcome: 'failed', reason: 'audit_error' });

    const out = await setupRunWorkflow({ setupRunId: 'run1' });

    expect(out.terminal).toBe(T.GBP_BLOCKED);
    expect(mocks.fetchAdsConversionCatalogActivity).not.toHaveBeenCalled();
    expect(mocks.createAdsCampaignActivity).not.toHaveBeenCalled();
  });

  it('blocks Ads creation when structural verification needs tracking fix', async () => {
    mocks.runStructuralVerificationActivity.mockResolvedValue({
      outcome: T.NEEDS_TRACKING_FIX,
      detail: { summary: 'snippet' },
    });

    const out = await setupRunWorkflow({ setupRunId: 'x' });

    expect(mocks.createAdsCampaignActivity).not.toHaveBeenCalled();
    expect(out.terminal).toBe(T.NEEDS_TRACKING_FIX);
    expect(out.ads).toBeNull();
  });

  it('blocks Ads creation when structural verification needs snippet install', async () => {
    mocks.runStructuralVerificationActivity.mockResolvedValue({
      outcome: T.SNIPPET_PENDING,
      detail: { summary: 'install snippet' },
    });

    const out = await setupRunWorkflow({ setupRunId: 'x' });

    expect(mocks.createAdsCampaignActivity).not.toHaveBeenCalled();
    expect(out.terminal).toBe(T.SNIPPET_PENDING);
    expect(out.ads).toBeNull();
  });

  it('blocks Ads creation when structural verification needs manual review', async () => {
    mocks.runStructuralVerificationActivity.mockResolvedValue({
      outcome: T.MANUAL_REVIEW,
      detail: { summary: 'cannot fetch website' },
    });

    const out = await setupRunWorkflow({ setupRunId: 'x' });

    expect(mocks.createAdsCampaignActivity).not.toHaveBeenCalled();
    expect(out.terminal).toBe(T.MANUAL_REVIEW);
    expect(out.ads).toBeNull();
  });

  it('still creates Ads when structural verification is skipped (optional GTM)', async () => {
    mocks.runStructuralVerificationActivity.mockResolvedValue({
      outcome: 'pass',
      skipped: true,
      detail: { summary: 'GTM is not configured; structural verification skipped.' },
    });

    const out = await setupRunWorkflow({ setupRunId: 'x' });

    expect(mocks.createAdsCampaignActivity).toHaveBeenCalled();
    expect(out.terminal).toBe(T.SUCCEEDED);
  });

  it('returns deterministic summary on success', async () => {
    const out = await setupRunWorkflow({ setupRunId: 'run1' });

    expect(out).toEqual(
      expect.objectContaining({
        workflow: 'setupRunWorkflow',
        terminal: T.SUCCEEDED,
        setupRunId: 'run1',
      })
    );
    expect(out.gbp).toEqual(expect.objectContaining({ outcome: 'skipped' }));
  });

  it('does not import nondeterministic or side-effect modules', () => {
    for (const pattern of FORBIDDEN_WORKFLOW_PATTERNS) {
      expect(WORKFLOW_SOURCE).not.toMatch(pattern);
    }
  });

  it('registers every workflow activity on the worker', () => {
    for (const name of SETUP_RUN_WORKFLOW_ACTIVITIES) {
      expect(typeof activities[name]).toBe('function');
    }
  });

  it('uses explicit Temporal activity policy groups', () => {
    expect(proxyActivities).toHaveBeenCalledWith(SETUP_ACTIVITY_POLICIES.control);
    expect(proxyActivities).toHaveBeenCalledWith(SETUP_ACTIVITY_POLICIES.precondition);
    expect(proxyActivities).toHaveBeenCalledWith(SETUP_ACTIVITY_POLICIES.read);
    expect(proxyActivities).toHaveBeenCalledWith(SETUP_ACTIVITY_POLICIES.mutate);
    expect(proxyActivities).toHaveBeenCalledTimes(4);
  });

  it('does not create Ads campaign when structural verification has not passed', async () => {
    const terminals = ['needs_tracking_fix', 'snippet_pending', 'manual_review'];
    for (const terminal of terminals) {
      Object.values(mocks).forEach((fn) => fn.mockReset());
      happyPathDefaults();
      mocks.runStructuralVerificationActivity.mockResolvedValue({
        outcome: terminal,
        detail: { summary: terminal },
      });

      const out = await setupRunWorkflow({ setupRunId: 'run-block' });
      expect(out.terminal).toBe(terminal);
      expect(mocks.createAdsCampaignActivity).not.toHaveBeenCalled();
      expect(out.ads).toBeNull();
    }
  });
});
