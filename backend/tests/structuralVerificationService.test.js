'use strict';

jest.mock('axios');

const axios = require('axios');
const mongoose = require('mongoose');
const {
  runStructuralVerification,
  detectSnippetInHtml,
  computeExpectedStructure,
  verifyAdsConversionLinkage,
} = require('../services/capabilities/structuralVerificationService');
const { runGtmConversionSetup } = require('../services/capabilities/gtmConversionSetupService');
const { fetchAndPersistConversionCatalog } = require('../services/capabilities/adsConversionCatalogService');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { createLogger } = require('../lib/observability/logger');
const { connectGoogleIntegrations } = require('./fixtures/setupRunFixtures');

describe('structuralVerificationService', () => {
  const logger = createLogger({ level: 'silent' });

  async function seedVerifiedRun(email, goalPrimary = 'both') {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const IntegrationConnection = mongoose.model('IntegrationConnection');

    const user = await User.create({ email });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      websiteUrl: 'https://acme.example',
      goals: { primary: goalPrimary },
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });

    await connectGoogleIntegrations(bc.businessId);

    await fetchAndPersistConversionCatalog({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });
    await runGtmConversionSetup({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    return { bc, run };
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('detectSnippetInHtml finds public container id and gtm.js loader', () => {
    expect(detectSnippetInHtml('<html>GTM-MOCK</html>', 'GTM-MOCK')).toBe(true);
    expect(
      detectSnippetInHtml(
        '<script src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC"></script>',
        'GTM-ABC'
      )
    ).toBe(true);
    expect(detectSnippetInHtml('<html>no tag manager</html>', 'GTM-MOCK')).toBe(false);
  });

  it('passes when GTM structure is complete and snippet is present', async () => {
    const { bc, run } = await seedVerifiedRun('verify-pass@test.com', 'both');
    axios.get.mockResolvedValue({
      data: '<html><script src="https://www.googletagmanager.com/gtm.js?id=GTM-MOCK"></script></html>',
    });

    const verdict = await runStructuralVerification({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(verdict.result).toBe('pass');
    expect(verdict.evidence.snippetPresent).toBe(true);
    expect(verdict.evidence.missing).toEqual([]);
  });

  it('returns snippet_pending when structure is valid but snippet is missing', async () => {
    const { bc, run } = await seedVerifiedRun('verify-snippet@test.com', 'calls');
    axios.get.mockResolvedValue({ data: '<html>no gtm here</html>' });

    const verdict = await runStructuralVerification({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(verdict.result).toBe('snippet_pending');
    expect(verdict.evidence.missing).toEqual(['snippet']);
    expect(verdict.evidence.snippetPresent).toBe(false);
  });

  it('returns manual_review_required when website URL is missing', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const user = await User.create({ email: 'verify-no-url@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });

    const verdict = await runStructuralVerification({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(verdict.result).toBe('manual_review_required');
    expect(verdict.evidence.missing).toEqual(['website_url']);
  });

  it('returns manual_review_required when public container id is missing', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const user = await User.create({ email: 'verify-no-pub@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      websiteUrl: 'https://acme.example',
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'gtm',
      connectionHealth: 'connected',
      providerIdentifiers: { containerId: 'only-container' },
    });

    const verdict = await runStructuralVerification({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(verdict.result).toBe('manual_review_required');
    expect(verdict.evidence.missing).toEqual(['public_container_id']);
  });

  it('returns needs_tracking_fix when GTM tag artifacts are missing', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');

    const user = await User.create({ email: 'verify-no-tags@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      websiteUrl: 'https://acme.example',
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'gtm',
      connectionHealth: 'connected',
      providerIdentifiers: { publicContainerId: 'GTM-MOCK' },
    });
    await IntegrationArtifact.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      provider: 'google_ads',
      artifactType: 'ads_conversion_action',
      externalId: '1001',
      metadata: { logicalCategory: 'call' },
    });

    axios.get.mockResolvedValue({ data: '<html>GTM-MOCK</html>' });

    const verdict = await runStructuralVerification({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(verdict.result).toBe('needs_tracking_fix');
    expect(verdict.evidence.missing).toEqual(
      expect.arrayContaining(['gtm_tags', 'gtm_triggers', 'gtm_variables', 'published_container_version'])
    );
  });

  it('returns needs_tracking_fix when Ads conversion is not linked to a GTM tag', async () => {
    const { bc, run } = await seedVerifiedRun('verify-link@test.com', 'calls');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    await IntegrationArtifact.deleteMany({
      setupRunId: run._id,
      provider: 'gtm',
      artifactType: 'gtm_tag',
    });
    axios.get.mockResolvedValue({ data: '<html>GTM-MOCK</html>' });

    const verdict = await runStructuralVerification({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(verdict.result).toBe('needs_tracking_fix');
    expect(verdict.evidence.missing).toEqual(expect.arrayContaining(['gtm_tags']));
  });

  it('returns manual_review_required when website fetch fails', async () => {
    const { bc, run } = await seedVerifiedRun('verify-fetch-fail@test.com', 'calls');
    axios.get.mockRejectedValue(new Error('network down'));

    const verdict = await runStructuralVerification({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(verdict.result).toBe('manual_review_required');
    expect(verdict.evidence.missing).toEqual(['website_fetch']);
  });

  it('verifyAdsConversionLinkage detects missing tag bindings', () => {
    const missing = verifyAdsConversionLinkage(
      [{ externalId: '1001', metadata: { logicalCategory: 'call' } }],
      [],
      []
    );
    expect(missing).toContain('gtm_tag_for_1001');
  });

  it('computeExpectedStructure reflects selected conversion categories', () => {
    const expected = computeExpectedStructure(
      [
        { externalId: '1', metadata: { logicalCategory: 'call' } },
        { externalId: '2', metadata: { logicalCategory: 'form' } },
      ],
      'https://acme.example'
    );
    expect(expected.gtmTags).toBe(2);
    expect(expected.gtmTriggers).toBe(4);
  });
});
