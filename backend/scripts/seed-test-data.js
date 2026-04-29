/**
 * Insert one interconnected row per core collection to verify Atlas ↔ Mongoose schemas.
 * Run from backend/: `npm run seed:test`
 *
 * Safe: creates a NEW user email `seed-{timestamp}@test.zuggernaut.local`.
 * Optional cleanup: `node scripts/seed-test-data.js --cleanup-email seed-...@test.zuggernaut.local`
 */
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const {
  User,
  BusinessContext,
  SetupRun,
  SetupStepExecution,
  IntegrationConnection,
  ProviderSnapshot,
  IntegrationArtifact,
  AuditReport,
  CampaignPlan,
} = require('../models');

const uri =
  process.env.MONGODB_URI ||
  process.env.mongodb_uri ||
  'mongodb://localhost:27017/zuggernaut_test';

async function cleanupByEmail(email) {
  const u = await User.findOne({ email });
  if (!u || !u.primaryBusinessId) {
    console.warn('Cleanup: no user or primaryBusinessId found for', email);
    return;
  }
  const bid = u.primaryBusinessId;
  await SetupStepExecution.deleteMany({ businessId: bid });
  await AuditReport.deleteMany({ businessId: bid });
  await CampaignPlan.deleteMany({ businessId: bid });
  await IntegrationArtifact.deleteMany({ businessId: bid });
  await ProviderSnapshot.deleteMany({ businessId: bid });
  await IntegrationConnection.deleteMany({ businessId: bid });
  await SetupRun.deleteMany({ businessId: bid });
  await BusinessContext.deleteMany({ businessId: bid });
  await User.deleteMany({ email });
  console.warn('Cleanup: removed seeded data for', email);
}

async function seed() {
  const cleanupEmailIdx = process.argv.indexOf('--cleanup-email');
  if (cleanupEmailIdx !== -1 && process.argv[cleanupEmailIdx + 1]) {
    await mongoose.connect(uri);
    await cleanupByEmail(process.argv[cleanupEmailIdx + 1]);
    await mongoose.disconnect();
    process.exit(0);
  }

  const stamp = `${Date.now()}`;
  const businessId = new mongoose.Types.ObjectId();
  const email = `seed-${stamp}@test.zuggernaut.local`;

  await mongoose.connect(uri);
  console.warn('MongoDB:', uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'));

  const user = await User.create({
    email,
    name: 'Seed Tester',
    googleSub: `google-sub-${stamp}`,
    primaryBusinessId: businessId,
  });

  const ctx = await BusinessContext.create({
    businessId,
    userId: user._id,
    websiteUrl: 'https://example.com',
    businessName: `Test Business ${stamp}`,
    industry: 'Services',
    services: ['plumbing'],
    serviceAreas: ['Austin TX'],
    goals: { primary: 'leads' },
    confirmedAt: new Date(),
  });

  const run = await SetupRun.create({
    businessId,
    temporalWorkflowId: `setup-workflow-${stamp}`,
    status: 'USER_INPUT_COLLECTED',
    meta: { seedRunner: true, stamp },
  });

  await SetupStepExecution.create([
    {
      setupRunId: run._id,
      businessId,
      stepName: 'gbp_audit',
      provider: 'gbp',
      status: 'success',
      attemptCount: 1,
      startedAt: new Date(),
      endedAt: new Date(),
    },
    {
      setupRunId: run._id,
      businessId,
      stepName: 'ads_conversion_catalog',
      provider: 'google_ads',
      status: 'pending',
      attemptCount: 0,
    },
  ]);

  await IntegrationConnection.insertMany([
    {
      businessId,
      provider: 'gbp',
      connectionHealth: 'connected',
      providerIdentifiers: { accountIdHint: `gbp-acc-${stamp}` },
      scopes: ['openid'],
      tokenExpiryAt: new Date(Date.now() + 3600 * 1000),
    },
    {
      businessId,
      provider: 'gtm',
      connectionHealth: 'pending',
      providerIdentifiers: {
        containerIdHint: `GTM-XXXX-${stamp}`,
      },
    },
    {
      businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      providerIdentifiers: { customerId: `123-${stamp}` },
      scopes: ['https://www.googleapis.com/auth/adwords'],
    },
  ]);

  await ProviderSnapshot.create({
    businessId,
    setupRunId: run._id,
    provider: 'google_ads',
    snapshotType: 'ads_conversion_catalog',
    payload: {
      seeded: true,
      conversions: [{ name: `call-${stamp}`, id: `conv_${stamp}` }],
    },
    sourceVersionHint: 'v1',
    immutable: true,
    snapshotVersion: 1,
  });

  await IntegrationArtifact.create([
    {
      businessId,
      setupRunId: run._id,
      provider: 'gtm',
      artifactType: 'gtm_container',
      externalId: `GTM_CONTAINER_${stamp}`,
      metadata: { containerPath: `/accounts/*/containers/*` },
      idempotencyKey: `seed-gtm-${stamp}`,
    },
    {
      businessId,
      setupRunId: run._id,
      provider: 'google_ads',
      artifactType: 'ads_conversion_action',
      externalId: `EXT_CONV_${stamp}`,
      metadata: { mappedFromCatalog: true },
      idempotencyKey: `seed-ads-ca-${stamp}`,
    },
  ]);

  await AuditReport.create({
    businessId,
    setupRunId: run._id,
    findings: {
      present: ['phone'],
      missing: [],
      needsAttention: ['hours'],
    },
    rawProviderRefs: { seeded: true },
  });

  await CampaignPlan.create({
    businessId,
    setupRunId: run._id,
    status: 'draft',
    intent: {
      objective: 'leads',
      dailyBudgetUsd: 42,
      structure: ['search_campaign_v1'],
    },
  });

  console.warn('\nSeed OK — check Atlas collections for these ids:\n', {
    userId: user._id.toString(),
    businessId: ctx.businessId.toString(),
    setupRunId: run._id.toString(),
    testUserEmail: email,
  });

  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
