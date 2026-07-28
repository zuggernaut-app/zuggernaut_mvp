'use strict';

const axios = require('axios');
const mongoose = require('mongoose');
const { createLogger } = require('../lib/observability/logger');
const { runGbpReadOnlyAudit } = require('../services/capabilities/gbpReadOnlyAuditService');
const { fetchAndPersistConversionCatalog } = require('../services/capabilities/adsConversionCatalogService');
const { runGtmConversionSetup } = require('../services/capabilities/gtmConversionSetupService');
const { runStructuralVerification } = require('../services/capabilities/structuralVerificationService');
const { createAdsAutoCampaign } = require('../services/capabilities/adsAutoCampaignService');
const { manageConversionActions } = require('../services/capabilities/adsConversionActionManagementService');
const { provisionGtmResources } = require('../services/capabilities/gtmProvisioningService');
const { buildSetupRunReport } = require('../services/reports/setupRunReportService');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { allScopesForProvider } = require('../constants/googleOAuth');
const { DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER } = require('../constants/provisioning');
const {
  createConfirmedBusiness,
  connectGoogleIntegrations,
  markStructuralVerificationPassed,
} = require('./fixtures/setupRunFixtures');

describe('setup run integration (mocked provider APIs)', () => {
  const logger = createLogger({ level: 'silent' });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('runs full happy path through capability services and produces a succeeded report', async () => {
    const { bc, run } = await createConfirmedBusiness('int-happy@test.com', { withGbp: false });
    await connectGoogleIntegrations(bc.businessId, { withGbp: false });

    await runGbpReadOnlyAudit({ setupRunId: run._id, businessId: bc.businessId, logger });
    await fetchAndPersistConversionCatalog({ setupRunId: run._id, businessId: bc.businessId, logger });
    const gtmResult = await runGtmConversionSetup({ setupRunId: run._id, businessId: bc.businessId, logger });

    jest.spyOn(axios, 'get').mockResolvedValue({
      status: 200,
      data: '<html><script src="https://www.googletagmanager.com/gtm.js?id=GTM-MOCK"></script></html>',
    });

    const verify = await runStructuralVerification({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });
    expect(verify.result).toBe('pass');
    await markStructuralVerificationPassed(run._id, bc.businessId);

    const ads = await createAdsAutoCampaign({ setupRunId: run._id, businessId: bc.businessId, logger });
    expect(ads.summary.campaignCreated).toBe(true);

    await mongoose.model('SetupRun').updateOne(
      { _id: run._id },
      {
        $set: {
          status: 'SUCCEEDED',
          meta: {
            gbpAudit: 'skipped',
            catalog: 'ready',
            gtm: 'setup_complete',
            gtmSummary: gtmResult.summary,
            structuralVerification: verify.evidence,
            ads: 'campaigns_recorded',
            adsCampaignSummary: ads.summary,
          },
        },
      }
    );

    const report = await buildSetupRunReport(run._id);
    expect(report.outcome.kind).toBe('succeeded');
    expect(report.adsCampaign.status).toBe('campaigns_recorded');
    expect(report.gtmSetup.status).toBe('setup_complete');
    expect(report.structuralVerification.status).toBe('pass');
  });

  it('GBP skipped path still reaches Ads catalog with integrations connected', async () => {
    const { bc, run } = await createConfirmedBusiness('int-gbp-skip@test.com');
    await connectGoogleIntegrations(bc.businessId);

    await fetchAndPersistConversionCatalog({ setupRunId: run._id, businessId: bc.businessId, logger });

    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    expect(
      await IntegrationArtifact.countDocuments({
        setupRunId: run._id,
        artifactType: 'ads_conversion_action',
      })
    ).toBeGreaterThanOrEqual(1);
  });

  it('structural verification returns snippet_pending when snippet is missing', async () => {
    const { bc, run } = await createConfirmedBusiness('int-snippet@test.com');
    await connectGoogleIntegrations(bc.businessId);
    await fetchAndPersistConversionCatalog({ setupRunId: run._id, businessId: bc.businessId, logger });
    await runGtmConversionSetup({ setupRunId: run._id, businessId: bc.businessId, logger });

    jest.spyOn(axios, 'get').mockResolvedValue({
      status: 200,
      data: '<html><body>No GTM here</body></html>',
    });

    const verify = await runStructuralVerification({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });
    expect(verify.result).toBe('snippet_pending');
    expect(verify.evidence.missing).toContain('snippet');
  });

  it('Ads campaign creation resumes from partial artifacts after simulated failure', async () => {
    const { bc, run } = await createConfirmedBusiness('int-partial@test.com');
    await connectGoogleIntegrations(bc.businessId);
    await fetchAndPersistConversionCatalog({ setupRunId: run._id, businessId: bc.businessId, logger });
    await markStructuralVerificationPassed(run._id, bc.businessId);

    const { seedPartialAdsCampaignArtifacts } = require('./fixtures/setupRunFixtures');
    await seedPartialAdsCampaignArtifacts(run._id, bc.businessId);

    const second = await createAdsAutoCampaign({ setupRunId: run._id, businessId: bc.businessId, logger });
    expect(second.summary.reusedArtifacts).toBeGreaterThanOrEqual(1);
    expect(second.summary.adCreated).toBe(true);
  });

  it('manageAdsConversionActions resolves required slots before catalog persistence', async () => {
    const { bc, run } = await createConfirmedBusiness('int-manage-ca@test.com', {
      goals: { primary: 'calls' },
    });
    await connectGoogleIntegrations(bc.businessId);

    const manage = await manageConversionActions({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(manage.outcome).toBe('ok');
    expect(manage.slotsResolved).toBeGreaterThanOrEqual(1);

    await fetchAndPersistConversionCatalog({ setupRunId: run._id, businessId: bc.businessId, logger });

    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    expect(
      await IntegrationArtifact.countDocuments({
        setupRunId: run._id,
        artifactType: 'ads_conversion_action',
      })
    ).toBeGreaterThanOrEqual(1);
  });

  it('GTM provisioning branch creates workspace artifacts then continues setup', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const IntegrationProvisioningRequest = mongoose.model('IntegrationProvisioningRequest');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');

    const user = await User.create({ email: `int-gtm-prov-${Date.now()}@test.com` });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      businessName: 'Provision Co',
      websiteUrl: 'https://provision.example',
      services: ['Plumbing'],
      serviceAreas: ['Springfield'],
      goals: { primary: 'calls' },
    });
    const run = await mongoose.model('SetupRun').create({
      businessId: bc.businessId,
      status: 'RUNNING',
    });

    const token = encryptToken('test-access');
    const refresh = encryptToken('test-refresh');
    const expiry = new Date(Date.now() + 3600_000);

    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'gtm',
      connectionHealth: 'provisioning_required',
      accessTokenEnc: token,
      refreshTokenEnc: refresh,
      tokenExpiryAt: expiry,
      scopes: allScopesForProvider('gtm'),
      providerIdentifiers: { discoveryReason: 'GTM_PROVISIONING_REQUIRED' },
    });

    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      accessTokenEnc: token,
      refreshTokenEnc: refresh,
      tokenExpiryAt: expiry,
      scopes: ['https://www.googleapis.com/auth/adwords'],
      providerIdentifiers: { customerId: '1234567890' },
    });

    const request = await IntegrationProvisioningRequest.create({
      businessId: bc.businessId,
      provider: 'gtm',
      requestedResources: DEFAULT_REQUESTED_RESOURCES_BY_PROVIDER.gtm,
      status: 'approved',
      approvedByUserId: user._id,
      approvedAt: new Date(),
      setupRunId: run._id,
    });

    const provisioned = await provisionGtmResources({
      setupRunId: run._id,
      businessId: bc.businessId,
      provisioningRequestId: request._id,
      logger,
    });

    expect(provisioned.connectionHealth).toBe('connected');
    expect(provisioned.providerIdentifiers?.accountId).toBeTruthy();
    expect(provisioned.providerIdentifiers?.containerId).toBeTruthy();
    expect(provisioned.providerIdentifiers?.workspaceId).toBeTruthy();

    const gtmArtifacts = await IntegrationArtifact.find({
      businessId: bc.businessId,
      setupRunId: run._id,
      provider: 'gtm',
    }).lean();
    expect(gtmArtifacts.map((a) => a.artifactType).sort()).toEqual([
      'gtm_account',
      'gtm_container',
      'gtm_workspace',
    ]);

    const manage = await manageConversionActions({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });
    expect(manage.outcome).toBe('ok');

    await fetchAndPersistConversionCatalog({ setupRunId: run._id, businessId: bc.businessId, logger });
    const gtmResult = await runGtmConversionSetup({ setupRunId: run._id, businessId: bc.businessId, logger });
    expect(gtmResult.summary.tagsCreated).toBeGreaterThan(0);
  });
});
