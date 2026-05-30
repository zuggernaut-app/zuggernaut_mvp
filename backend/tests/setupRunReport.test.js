'use strict';

const mongoose = require('mongoose');
const {
  buildSetupRunReport,
  mapOutcomeKind,
  buildRecovery,
} = require('../services/reports/setupRunReportService');
const { SETUP_STEP_NAMES } = require('../constants/setupWorkflow');

describe('setupRunReportService', () => {
  async function seedReportFixtures(opts = {}) {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const AuditReport = mongoose.model('AuditReport');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const CampaignPlan = mongoose.model('CampaignPlan');

    const user = await User.create({ email: opts.email ?? 'report@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      businessName: 'Acme Co',
      websiteUrl: 'https://acme.example',
      goals: { primary: 'calls' },
    });
    const run = await SetupRun.create({
      businessId: bc.businessId,
      status: opts.status ?? 'SUCCEEDED',
      lastErrorSummary: opts.lastErrorSummary ?? null,
      meta: opts.meta ?? {
        gbpAudit: 'complete',
        gbpAuditSummary: { presentCount: 3, missingCount: 1, needsAttentionCount: 0 },
        catalog: 'ready',
        catalogSummary: {
          primaryGoal: 'calls',
          totalInCatalog: 2,
          selectedCount: 1,
          selectedCategories: ['call'],
        },
        gtm: 'setup_complete',
        gtmSummary: {
          templateVersion: 1,
          tagsCreated: 2,
          triggersCreated: 4,
          variablesCreated: 3,
          reusedArtifacts: 0,
          publishedVersion: 'accounts/mock/versions/1',
        },
        structuralVerification: { missing: [], snippetPresent: true, publicContainerId: 'GTM-MOCK' },
        structuralVerificationSummary: 'All checks passed',
        ads: 'campaigns_recorded',
        adsCampaignSummary: {
          campaignCreated: true,
          adGroupCreated: true,
          adCreated: true,
          reusedArtifacts: 0,
          campaignExternalId: 'customers/123/campaigns/zug-campaign',
          conversionLinkCount: 1,
        },
      },
    });

    await SetupStepExecution.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      stepName: SETUP_STEP_NAMES.GBP_AUDIT,
      status: 'success',
      provider: 'gbp',
      attemptCount: 1,
    });
    await SetupStepExecution.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      stepName: SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
      status: 'success',
      provider: 'google_ads',
      attemptCount: 1,
    });

    if (opts.withAuditReport !== false) {
      await AuditReport.create({
        setupRunId: run._id,
        businessId: bc.businessId,
        findings: {
          present: ['Business name'],
          missing: ['Hours'],
          needsAttention: [],
        },
      });
    }

    await IntegrationArtifact.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      provider: 'google_ads',
      artifactType: 'ads_campaign',
      externalId: 'customers/123/campaigns/zug-campaign',
      idempotencyKey: `ads-${run._id}-campaign`,
    });

    await CampaignPlan.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      status: 'applied',
      intent: {
        campaignName: 'Acme Co — Zuggernaut Search',
        bidding: 'maximize_conversions',
        budget: { amountMicros: 10_000_000 },
      },
    });

    return { bc, run, user };
  }

  it('mapOutcomeKind maps terminal setup run statuses', () => {
    expect(mapOutcomeKind('SUCCEEDED')).toBe('succeeded');
    expect(mapOutcomeKind('GTM_SNIPPET_PENDING')).toBe('snippet_pending');
    expect(mapOutcomeKind('SETUP_NEEDS_TRACKING_FIX')).toBe('tracking_fix');
    expect(mapOutcomeKind('RUNNING')).toBe('in_progress');
  });

  it('buildRecovery returns snippet install guidance', () => {
    const recovery = buildRecovery('snippet_pending', { publicContainerId: 'GTM-ABC' });
    expect(recovery?.title).toMatch(/Google Tag Manager snippet/i);
    expect(recovery?.steps.join(' ')).toContain('GTM-ABC');
  });

  it('buildSetupRunReport aggregates normalized sections for a successful run', async () => {
    const { run } = await seedReportFixtures();

    const report = await buildSetupRunReport(run._id);
    expect(report).toBeTruthy();
    expect(report.setupRun.status).toBe('SUCCEEDED');
    expect(report.outcome.kind).toBe('succeeded');
    expect(report.business?.businessName).toBe('Acme Co');
    expect(report.gbpAudit.status).toBe('complete');
    expect(report.gbpAudit.findings?.present).toContain('Business name');
    expect(report.adsCatalog.status).toBe('ready');
    expect(report.gtmSetup.status).toBe('setup_complete');
    expect(report.structuralVerification.status).toBe('pass');
    expect(report.adsCampaign.status).toBe('campaigns_recorded');
    expect(report.adsCampaign.plan?.campaignName).toContain('Acme Co');
    expect(report.artifactCounts.adsCampaigns).toBe(1);
    expect(report.steps.length).toBeGreaterThanOrEqual(2);
  });

  it('buildSetupRunReport handles GBP skipped and snippet pending states', async () => {
    const { run } = await seedReportFixtures({
      email: 'report-snippet@test.com',
      status: 'GTM_SNIPPET_PENDING',
      lastErrorSummary: 'Install GTM snippet',
      meta: {
        gbpAudit: 'skipped',
        structuralVerification: { missing: ['snippet'], snippetPresent: false, publicContainerId: 'GTM-X' },
        structuralVerificationSummary: 'Install GTM snippet',
      },
      withAuditReport: false,
    });

    const SetupStepExecution = mongoose.model('SetupStepExecution');
    await SetupStepExecution.updateOne(
      { setupRunId: run._id, stepName: SETUP_STEP_NAMES.GBP_AUDIT },
      { $set: { status: 'skipped' } }
    );
    await SetupStepExecution.create({
      setupRunId: run._id,
      businessId: run.businessId,
      stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
      status: 'failed',
      provider: 'gtm',
      attemptCount: 1,
      lastErrorSummary: 'Install GTM snippet',
      details: { snippetPending: true, evidence: { missing: ['snippet'], snippetPresent: false } },
    });

    const report = await buildSetupRunReport(run._id);
    expect(report.outcome.kind).toBe('snippet_pending');
    expect(report.gbpAudit.status).toBe('skipped');
    expect(report.gbpAudit.findings).toBeNull();
    expect(report.outcome.recovery?.steps.join(' ')).toContain('GTM-X');
    expect(report.structuralVerification.status).toBe('snippet_pending');
  });

  it('buildSetupRunReport surfaces GBP guidance when profile is missing', async () => {
    const guidance = {
      code: 'GBP_NO_LOCATIONS',
      title: 'No Google Business Profile location found',
      message:
        'Your Google account has a Business Profile account but no locations. Add or claim a business location in Google Business Profile to enable the audit.',
      blocking: false,
    };
    const { run } = await seedReportFixtures({
      email: 'report-gbp-guidance@test.com',
      status: 'SUCCEEDED',
      meta: {
        gbpAudit: 'guidance',
        gbpAuditSummary: { presentCount: 0, missingCount: 0, needsAttentionCount: 1 },
        gbpGuidance: guidance,
        catalog: 'ready',
        gtm: 'setup_complete',
        ads: 'campaigns_recorded',
      },
      withAuditReport: true,
    });

    const SetupStepExecution = mongoose.model('SetupStepExecution');
    await SetupStepExecution.updateOne(
      { setupRunId: run._id, stepName: SETUP_STEP_NAMES.GBP_AUDIT },
      {
        $set: {
          status: 'skipped',
          details: { reason: 'GBP_NO_LOCATIONS', guidance, blocking: false },
        },
      }
    );

    const AuditReport = mongoose.model('AuditReport');
    await AuditReport.updateOne(
      { setupRunId: run._id },
      {
        $set: {
          findings: {
            present: [],
            missing: [],
            needsAttention: [guidance.message],
          },
        },
      }
    );

    const report = await buildSetupRunReport(run._id);
    expect(report.gbpAudit.status).toBe('guidance');
    expect(report.gbpAudit.reason).toBe('GBP_NO_LOCATIONS');
    expect(report.gbpAudit.guidance).toEqual(guidance);
    expect(report.gbpAudit.blocking).toBe(false);
    expect(report.gbpAudit.findings?.needsAttention).toContain(guidance.message);
  });

  it('returns null when setup run does not exist', async () => {
    const missing = await buildSetupRunReport(new mongoose.Types.ObjectId());
    expect(missing).toBeNull();
  });

  it('maps provisioning-required statuses and recovery guidance', () => {
    expect(mapOutcomeKind('GTM_PROVISIONING_REQUIRED')).toBe('provisioning_required');
    expect(mapOutcomeKind('ADS_PROVISIONING_REQUIRED')).toBe('provisioning_required');
    const recovery = buildRecovery('provisioning_required', null);
    expect(recovery?.title).toMatch(/Approve Google resource provisioning/i);
    expect(recovery?.steps.join(' ')).toMatch(/Approve provisioning/i);
  });

  it('buildSetupRunReport includes provisioning section and supportState', async () => {
    const { run } = await seedReportFixtures({
      email: 'report-provisioning@test.com',
      status: 'GTM_PROVISIONING_REQUIRED',
      lastErrorSummary: 'GTM provisioning approval required',
      meta: {
        gtmProvisioning: 'approval_required',
        gtmProvisioningRequestId: 'req-gtm-1',
      },
      withAuditReport: false,
    });

    const SetupRun = mongoose.model('SetupRun');
    await SetupRun.updateOne(
      { _id: run._id },
      {
        $set: {
          'meta.supportState': {
            failedStep: 'provision_gtm_resources',
            errorCode: 'GTM_PROVISIONING_FAILED',
            updatedAt: new Date().toISOString(),
          },
        },
      }
    );

    const report = await buildSetupRunReport(run._id);
    expect(report.outcome.kind).toBe('provisioning_required');
    expect(report.provisioning.gtm.status).toBe('approval_required');
    expect(report.provisioning.gtm.requestId).toBe('req-gtm-1');
    expect(report.supportState?.failedStep).toBe('provision_gtm_resources');
  });

  it('includes stuckState for long-running setup runs', async () => {
    const { detectStuckSetupRun, DEFAULT_STUCK_THRESHOLD_MS } = require('../services/setupRunStuckDetection');
    const { run } = await seedReportFixtures({
      email: 'report-stuck@test.com',
      status: 'RUNNING',
      meta: {},
      withAuditReport: false,
    });

    const oldUpdatedAt = new Date(Date.now() - DEFAULT_STUCK_THRESHOLD_MS - 5000);
    const SetupRun = mongoose.model('SetupRun');
    await SetupRun.collection.updateOne(
      { _id: run._id },
      { $set: { updatedAt: oldUpdatedAt, createdAt: oldUpdatedAt } }
    );

    const report = await buildSetupRunReport(run._id);
    expect(report.stuckState.stuck).toBe(true);
    expect(report.outcome.recovery?.title).toMatch(/stuck/i);
    expect(detectStuckSetupRun({ status: 'RUNNING', updatedAt: oldUpdatedAt }).stuck).toBe(true);
  });
});
