'use strict';

/**
 * Post-run verifier for Phase 10 Google Ads campaign creation.
 *
 * Usage (from backend/):
 *   npm run verify:phase10-setup-run -- <setupRunId>
 *
 * Reads MongoDB IntegrationArtifact + CampaignPlan for a completed setup run and
 * checks that keywords, geo criteria, and conversion linkage artifacts exist.
 * Use after a real-mode E2E run to capture evidence (see PHASE10_REAL_MODE_E2E_CHECKLIST.md).
 */

const path = require('path');

const backendRoot = path.join(__dirname, '..', '..', '..', 'backend');
require('dotenv').config({ path: path.join(backendRoot, '.env'), quiet: true });

const { backendRequire, mongoose } = require('../shared');

const { SETUP_STEP_NAMES } = backendRequire('./constants/setupWorkflow');
const { PROVIDER_MUTATION_CONTRACT } = backendRequire('./constants/idempotency');

const REQUIRED_ARTIFACT_TYPES = [
  'ads_campaign_budget',
  'ads_campaign',
  'ads_campaign_criterion',
  'ads_ad_group',
  'ads_keyword',
  'ads_ad',
  'ads_custom_conversion_goal',
  'ads_conversion_goal_campaign_config',
];

async function main() {
  const setupRunId = process.argv[2]?.trim();
  if (!setupRunId) {
    // eslint-disable-next-line no-console
    console.error('Usage: npm run verify:phase10-setup-run -- <setupRunId>');
    process.exit(1);
  }

  if (!process.env.MONGODB_URI?.trim()) {
    // eslint-disable-next-line no-console
    console.error('ERROR: MONGODB_URI is required.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);

  const SetupRun = mongoose.model('SetupRun');
  const CampaignPlan = mongoose.model('CampaignPlan');
  const IntegrationArtifact = mongoose.model('IntegrationArtifact');
  const SetupStepExecution = mongoose.model('SetupStepExecution');

  const run = await SetupRun.findById(setupRunId).lean();
  if (!run) {
    // eslint-disable-next-line no-console
    console.error(`ERROR: SetupRun not found: ${setupRunId}`);
    process.exit(1);
  }

  const artifacts = await IntegrationArtifact.find({
    setupRunId: run._id,
    provider: 'google_ads',
  }).lean();

  const byType = {};
  for (const row of artifacts) {
    byType[row.artifactType] = (byType[row.artifactType] ?? 0) + 1;
  }

  const plan = await CampaignPlan.findOne({ setupRunId: run._id }).lean();
  const adsStep = await SetupStepExecution.findOne({
    setupRunId: run._id,
    stepName: SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
  }).lean();
  const verifyStep = await SetupStepExecution.findOne({
    setupRunId: run._id,
    stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
  }).lean();

  const contract = PROVIDER_MUTATION_CONTRACT.find(
    (row) => row.stepName === SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION
  );

  const errors = [];
  const warnings = [];

  for (const artifactType of REQUIRED_ARTIFACT_TYPES) {
    if (!byType[artifactType]) {
      errors.push(`Missing google_ads artifact type: ${artifactType}`);
    }
  }

  if (!contract?.artifactTypes?.includes('ads_keyword')) {
    errors.push('Idempotency contract missing ads_keyword');
  }
  if (!contract?.artifactTypes?.includes('ads_campaign_criterion')) {
    errors.push('Idempotency contract missing ads_campaign_criterion');
  }

  if (!plan?.intent?.keywords?.length) {
    errors.push('CampaignPlan.intent.keywords is empty');
  }
  if (!plan?.intent?.geoTargets?.length) {
    errors.push('CampaignPlan.intent.geoTargets is empty');
  }
  if (plan?.intent?.campaign?.bidding !== 'manual_cpc') {
    errors.push('CampaignPlan.intent.campaign.bidding must be manual_cpc');
  }

  if (!adsStep || adsStep.status !== 'success') {
    errors.push(`ads_campaign_creation step must be success (got ${adsStep?.status ?? 'missing'})`);
  }

  const summary = run.meta?.adsCampaignSummary ?? adsStep?.details?.summary ?? null;
  if (!summary) {
    warnings.push('adsCampaignSummary not found on SetupRun.meta or step details');
  } else {
    if (!summary.geoTargetsCreated || summary.geoTargetsCreated < 1) {
      errors.push('adsCampaignSummary.geoTargetsCreated must be >= 1');
    }
    if (!summary.keywordsCreated || summary.keywordsCreated < 1) {
      errors.push('adsCampaignSummary.keywordsCreated must be >= 1');
    }
    if (!summary.conversionGoalLinked) {
      errors.push('adsCampaignSummary.conversionGoalLinked must be true');
    }
  }

  if (verifyStep?.status === 'failed') {
    warnings.push(
      'structural_verification step failed — Phase 10 strict gate should have blocked ads_campaign_creation'
    );
  }

  const report = {
    ok: errors.length === 0,
    setupRunId,
    setupRunStatus: run.status,
    businessId: run.businessId?.toString?.() ?? String(run.businessId),
    artifactCounts: byType,
    campaignPlanStatus: plan?.status ?? null,
    intentVersion: plan?.intent?.version ?? null,
    keywordCount: plan?.intent?.keywords?.length ?? 0,
    geoTargetCount: plan?.intent?.geoTargets?.length ?? 0,
    adsStepStatus: adsStep?.status ?? null,
    structuralVerificationStatus: verifyStep?.status ?? null,
    adsCampaignSummary: summary,
    errors,
    warnings,
  };

  // eslint-disable-next-line no-console
  console.warn(JSON.stringify(report, null, 2));

  await mongoose.disconnect();
  process.exit(errors.length === 0 ? 0 : 1);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
