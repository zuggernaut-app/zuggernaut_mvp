'use strict';

const mongoose = require('mongoose');
const { encryptToken } = require('../../lib/crypto/tokenEncryption');
const { SETUP_STEP_NAMES } = require('../../constants/setupWorkflow');
const { allScopesForProvider } = require('../../constants/googleOAuth');

/**
 * @param {string} email
 * @param {object} [opts]
 */
async function createConfirmedBusiness(email, opts = {}) {
  const User = mongoose.model('User');
  const BusinessContext = mongoose.model('BusinessContext');

  const user = await User.create({ email });
  const bc = await BusinessContext.create({
    userId: user._id,
    confirmedAt: new Date(),
    businessName: opts.businessName ?? 'Acme Co',
    websiteUrl: opts.websiteUrl ?? 'https://acme.example',
    goals: opts.goals ?? { primary: 'calls' },
    services: opts.services ?? ['Plumbing'],
    serviceAreas: opts.serviceAreas ?? ['Springfield'],
  });
  const run = await mongoose.model('SetupRun').create({
    businessId: bc.businessId,
    status: opts.runStatus ?? 'RUNNING',
    meta: opts.runMeta ?? null,
  });

  return { user, bc, run };
}

/**
 * @param {import('mongoose').Types.ObjectId} businessId
 * @param {object} [opts]
 */
async function connectGoogleIntegrations(businessId, opts = {}) {
  const IntegrationConnection = mongoose.model('IntegrationConnection');
  const token = encryptToken('test-access');
  const refresh = encryptToken('test-refresh');
  const expiry = new Date(Date.now() + 3600_000);

  await IntegrationConnection.create({
    businessId,
    provider: 'google_ads',
    connectionHealth: 'connected',
    accessTokenEnc: token,
    refreshTokenEnc: refresh,
    tokenExpiryAt: expiry,
    scopes: ['https://www.googleapis.com/auth/adwords'],
    providerIdentifiers: { customerId: opts.customerId ?? '1234567890' },
  });

  await IntegrationConnection.create({
    businessId,
    provider: 'gtm',
    connectionHealth: 'connected',
    accessTokenEnc: token,
    refreshTokenEnc: refresh,
    tokenExpiryAt: expiry,
    scopes: allScopesForProvider('gtm'),
    providerIdentifiers: {
      accountId: opts.accountId ?? 'mock-account',
      containerId: opts.containerId ?? 'mock-container',
      workspaceId: opts.workspaceId ?? 'mock-workspace',
      publicContainerId: opts.publicContainerId ?? 'GTM-MOCK',
    },
  });

  if (opts.withGbp) {
    await IntegrationConnection.create({
      businessId,
      provider: 'gbp',
      connectionHealth: 'connected',
      accessTokenEnc: token,
      refreshTokenEnc: refresh,
      tokenExpiryAt: expiry,
      scopes: ['https://www.googleapis.com/auth/business.manage'],
      providerIdentifiers: { locationId: 'locations/123' },
    });
  }
}

/**
 * @param {import('mongoose').Types.ObjectId} setupRunId
 * @param {import('mongoose').Types.ObjectId} businessId
 */
async function markStructuralVerificationPassed(setupRunId, businessId) {
  await mongoose.model('SetupStepExecution').create({
    setupRunId,
    businessId,
    stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
    status: 'success',
    provider: 'gtm',
    attemptCount: 1,
  });
}

/**
 * @param {import('mongoose').Types.ObjectId} setupRunId
 * @param {import('mongoose').Types.ObjectId} businessId
 */
async function seedPartialAdsCampaignArtifacts(setupRunId, businessId, customerId = '1234567890') {
  const IntegrationArtifact = mongoose.model('IntegrationArtifact');
  const sid = setupRunId.toString();

  await IntegrationArtifact.create({
    setupRunId,
    businessId,
    provider: 'google_ads',
    artifactType: 'ads_campaign',
    externalId: `customers/${customerId}/campaigns/zug-campaign-${sid}`,
    idempotencyKey: `ads-${setupRunId}-campaign`,
    metadata: { createdBy: 'ads_auto_campaign_v1' },
  });
}

function succeededRunMeta(overrides = {}) {
  return {
    gbpAudit: 'complete',
    gbpAuditSummary: { presentCount: 2, missingCount: 0, needsAttentionCount: 0 },
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
    ads: 'campaigns_recorded',
    adsCampaignSummary: {
      campaignCreated: true,
      adGroupCreated: true,
      adCreated: true,
      reusedArtifacts: 0,
      campaignExternalId: 'customers/123/campaigns/zug-campaign',
      conversionLinkCount: 1,
    },
    ...overrides,
  };
}

module.exports = {
  createConfirmedBusiness,
  connectGoogleIntegrations,
  markStructuralVerificationPassed,
  seedPartialAdsCampaignArtifacts,
  succeededRunMeta,
};
