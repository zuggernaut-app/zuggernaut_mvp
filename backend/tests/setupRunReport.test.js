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
    const { run, bc } = await seedReportFixtures();

    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    await SetupRun.updateOne(
      { _id: run._id },
      {
        $set: {
          'meta.conversionActionManagement': 'ok',
          'meta.conversionActionSlotsResolved': 1,
          'meta.conversionActionsCreated': 0,
          'meta.conversionActionsReused': 1,
        },
      }
    );
    await SetupStepExecution.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      stepName: SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS,
      status: 'success',
      provider: 'google_ads',
      attemptCount: 1,
      details: { slotsResolved: 1, created: 0, reused: 1 },
    });

    const report = await buildSetupRunReport(run._id);
    expect(report).toBeTruthy();
    expect(report.setupRun.status).toBe('SUCCEEDED');
    expect(report.outcome.kind).toBe('succeeded');
    expect(report.business?.businessName).toBe('Acme Co');
    expect(report.gbpAudit.status).toBe('complete');
    expect(report.gbpAudit.findings?.present).toContain('Business name');
    expect(report.conversionActions).toEqual({
      status: 'ready',
      slotsResolved: 1,
      created: 0,
      reused: 1,
      message: null,
    });
    expect(report.adsCatalog.status).toBe('ready');
    expect(report.gtmSetup.status).toBe('setup_complete');
    expect(report.structuralVerification.status).toBe('pass');
    expect(report.adsCampaign.status).toBe('campaigns_recorded');
    expect(report.adsCampaign.failure).toBeNull();
    expect(report.adsCampaign.plan?.campaignName).toContain('Acme Co');
    expect(report.artifactCounts.adsCampaigns).toBe(1);
    expect(report.steps.length).toBeGreaterThanOrEqual(2);
    expect(report.recommendations).toEqual([]);
  });

  it('buildSetupRunReport surfaces tracking recommendations after successful Ads-only launch', async () => {
    const { run, bc } = await seedReportFixtures({
      email: 'report-reco@test.com',
      meta: {
        catalog: 'ready',
        catalogSummary: {
          primaryGoal: 'both',
          totalInCatalog: 10,
          selectedCount: 2,
          selectedCategories: ['call', 'form'],
        },
        conversionActionManagement: 'ok',
        structuralVerification: { gtmOptional: true, reason: 'missing_connection' },
        structuralVerificationSummary: 'GTM is not configured; structural verification skipped.',
        ads: 'campaigns_recorded',
        adsCampaignSummary: {
          campaignCreated: true,
          adGroupCreated: true,
          adCreated: true,
          reusedArtifacts: 0,
          campaignExternalId: 'customers/123/campaigns/zug-campaign',
          conversionLinkCount: 2,
        },
      },
      withAuditReport: false,
    });

    const SetupStepExecution = mongoose.model('SetupStepExecution');
    await SetupStepExecution.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
      status: 'skipped',
      provider: 'gtm',
      attemptCount: 1,
      details: {
        optional: true,
        evidence: { gtmOptional: true, reason: 'missing_connection' },
        summary: 'GTM is not configured; structural verification skipped.',
      },
    });

    const report = await buildSetupRunReport(run._id);
    expect(report.structuralVerification.status).toBe('skipped');
    expect(report.recommendations.length).toBeGreaterThanOrEqual(1);
    expect(report.recommendations[0].id).toBe('connect_gtm');
    expect(report.recommendations[0].title).toMatch(/Google Tag Manager/i);
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

  it('buildSetupRunReport surfaces conversion action creation summary', async () => {
    const { run, bc } = await seedReportFixtures({
      email: 'report-ca-create@test.com',
      meta: {
        conversionActionManagement: 'ok',
        conversionActionSlotsResolved: 2,
        conversionActionsCreated: 1,
        conversionActionsReused: 1,
        catalog: 'ready',
        ads: 'campaigns_recorded',
      },
      withAuditReport: false,
    });

    const SetupStepExecution = mongoose.model('SetupStepExecution');
    await SetupStepExecution.deleteMany({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS,
    });
    await SetupStepExecution.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      stepName: SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS,
      status: 'success',
      provider: 'google_ads',
      attemptCount: 1,
      details: { slotsResolved: 2, created: 1, reused: 1 },
    });

    const report = await buildSetupRunReport(run._id);
    expect(report.conversionActions.status).toBe('ready');
    expect(report.conversionActions.created).toBe(1);
    expect(report.conversionActions.reused).toBe(1);
    expect(report.conversionActions.slotsResolved).toBe(2);
  });

  it('buildSetupRunReport surfaces conversion action manual review', async () => {
    const { run, bc } = await seedReportFixtures({
      email: 'report-ca-review@test.com',
      status: 'SETUP_NEEDS_MANUAL_REVIEW',
      lastErrorSummary: 'Conversion action creation is disabled and required slots are unfilled.',
      meta: {},
      withAuditReport: false,
    });

    const SetupStepExecution = mongoose.model('SetupStepExecution');
    await SetupStepExecution.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      stepName: SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS,
      status: 'failed',
      provider: 'google_ads',
      attemptCount: 1,
      lastErrorSummary: 'Conversion action creation is disabled and required slots are unfilled.',
      details: { manualReview: true },
    });

    const report = await buildSetupRunReport(run._id);
    expect(report.conversionActions.status).toBe('manual_review');
    expect(report.conversionActions.message).toMatch(/disabled/i);
    expect(report.outcome.recovery?.title).toMatch(/manual setup/i);
  });

  it('buildSetupRunReport surfaces conversion action creation failure', async () => {
    const { run, bc } = await seedReportFixtures({
      email: 'report-ca-fail@test.com',
      status: 'FAILED',
      lastErrorSummary: 'Google Ads API mutate failed',
      meta: {},
      withAuditReport: false,
    });

    const SetupStepExecution = mongoose.model('SetupStepExecution');
    await SetupStepExecution.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      stepName: SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS,
      status: 'failed',
      provider: 'google_ads',
      attemptCount: 1,
      lastErrorSummary: 'Google Ads API mutate failed',
      details: { code: 'GOOGLE_ADS_MUTATE_FAILED', created: 0, reused: 1 },
    });

    const report = await buildSetupRunReport(run._id);
    expect(report.conversionActions.status).toBe('failed');
    expect(report.conversionActions.message).toMatch(/could not apply the requested changes/i);
    expect(report.conversionActions.message).not.toMatch(/Google Ads API/i);
    expect(report.outcome.recovery?.title).toMatch(/creation failed/i);
  });

  it('buildSetupRunReport leaves conversion actions not_run when step absent', async () => {
    const { run } = await seedReportFixtures({
      email: 'report-ca-absent@test.com',
      meta: { catalog: 'ready' },
      withAuditReport: false,
    });

    const report = await buildSetupRunReport(run._id);
    expect(report.conversionActions.status).toBe('not_run');
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

  it('buildSetupRunReport surfaces normalized Ads campaign failure details', async () => {
    const { ADS_INTENT_CODES } = require('../constants/adsCampaignIntent');
    const { recommendedActionForAdsFailure } = require('../services/reports/setupRunReportService');
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');

    const user = await User.create({ email: 'report-ads-fail@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      businessName: 'Fail Co',
      websiteUrl: 'https://fail.example',
      goals: { primary: 'calls' },
    });
    const run = await SetupRun.create({
      businessId: bc.businessId,
      status: 'FAILED',
      lastErrorSummary: 'Keyword text contains invalid characters or symbols.',
      meta: {},
    });

    await SetupStepExecution.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      stepName: SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
      status: 'failed',
      provider: 'google_ads',
      attemptCount: 1,
      lastErrorSummary: 'Keyword text contains invalid characters or symbols.',
      details: {
        provider: 'google_ads',
        stepName: SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
        message: 'Keyword text contains invalid characters or symbols.',
        code: ADS_INTENT_CODES.KEYWORD_INVALID_CHARS,
        validationBucket: 'keywords',
        field: 'keywords[0].text',
        issues: [
          {
            code: ADS_INTENT_CODES.KEYWORD_INVALID_CHARS,
            field: 'keywords[0].text',
            message: 'Keyword text contains invalid characters or symbols.',
            bucket: 'keywords',
          },
        ],
      },
    });

    const report = await buildSetupRunReport(run._id);
    expect(report.adsCampaign.status).toBe('failed');
    expect(report.adsCampaign.failure).toEqual(
      expect.objectContaining({
        provider: 'google_ads',
        stepName: SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
        validationBucket: 'keywords',
        bucketLabel: 'Bucket 3: Keywords',
        field: 'keywords[0].text',
        code: ADS_INTENT_CODES.KEYWORD_INVALID_CHARS,
        message: 'Keyword text contains invalid characters or symbols.',
        recommendedAction: recommendedActionForAdsFailure({
          validationBucket: 'keywords',
          code: ADS_INTENT_CODES.KEYWORD_INVALID_CHARS,
          field: 'keywords[0].text',
        }),
      })
    );
    expect(report.adsCampaign.failure?.recommendedAction).toBe(
      'Remove unsupported symbols or adjust business/service wording.'
    );
  });
});
