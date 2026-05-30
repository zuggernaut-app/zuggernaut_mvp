'use strict';

const axios = require('axios');
const mongoose = require('mongoose');
const { createLogger } = require('../lib/observability/logger');
const { runGbpReadOnlyAudit } = require('../services/capabilities/gbpReadOnlyAuditService');
const { fetchAndPersistConversionCatalog } = require('../services/capabilities/adsConversionCatalogService');
const { runGtmConversionSetup } = require('../services/capabilities/gtmConversionSetupService');
const { runStructuralVerification } = require('../services/capabilities/structuralVerificationService');
const { createAdsAutoCampaign } = require('../services/capabilities/adsAutoCampaignService');
const { buildSetupRunReport } = require('../services/reports/setupRunReportService');
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
});
