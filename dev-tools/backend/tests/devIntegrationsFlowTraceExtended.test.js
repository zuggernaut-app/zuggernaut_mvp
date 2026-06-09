'use strict';

const { mongoose } = require('../shared');
const { createBareUser } = require('../../../backend/tests/helpers');
const { completeGoogleOAuthCallback } = require('../../../backend/services/integrations/googleOAuthService');
const IntegrationConnection = mongoose.model('IntegrationConnection');
const {
  runDevIntegrationsFlowTraceExtended,
  formatExtendedTraceReport,
} = require('../lib/dev/devIntegrationsFlowTraceExtended');
const { resolveGoogleAdsCapabilityContext } = require('../lib/dev/googleAdsCapabilitiesTrace');
const { ensureSandboxBusiness } = require('../services/dev/integrationDiagnosticsService');

describe('devIntegrationsFlowTraceExtended', () => {
  const prevAdsEnabled = process.env.GOOGLE_ADS_API_ENABLED;
  const prevDevToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

  beforeAll(() => {
    process.env.GOOGLE_ADS_API_ENABLED = 'true';
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = process.env.GOOGLE_ADS_DEVELOPER_TOKEN || 'test-dev-token';
  });

  afterAll(() => {
    if (prevAdsEnabled === undefined) delete process.env.GOOGLE_ADS_API_ENABLED;
    else process.env.GOOGLE_ADS_API_ENABLED = prevAdsEnabled;
    if (prevDevToken === undefined) delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    else process.env.GOOGLE_ADS_DEVELOPER_TOKEN = prevDevToken;
  });

  it('skips Google Ads capability stages for non-google_ads providers', async () => {
    const user = await createBareUser('trace-ext-gtm@test.com');
    const sandbox = await ensureSandboxBusiness(user._id);

    const report = await runDevIntegrationsFlowTraceExtended({
      provider: 'gtm',
      businessId: sandbox.businessId,
      userId: user._id.toString(),
    });

    const skipped = report.stages.find((s) => s.id === 'google_ads_capabilities_skipped');
    expect(skipped?.skipped).toBe(true);
    expect(skipped?.ok).toBe(true);
    expect(report.extended).toBe(true);
    expect(formatExtendedTraceReport(report)).toContain('Extended Google Ads Capabilities');
  });

  it('resolveGoogleAdsCapabilityContext requires an explicit customer selection', async () => {
    const user = await createBareUser('trace-ext-ads@test.com');
    const sandbox = await ensureSandboxBusiness(user._id);

    await completeGoogleOAuthCallback({
      businessId: sandbox.businessId,
      provider: 'google_ads',
      userId: user._id.toString(),
      code: 'mock-auth-code',
    });

    await IntegrationConnection.updateOne(
      { businessId: sandbox.businessId, provider: 'google_ads' },
      {
        $unset: { 'providerIdentifiers.customerId': '' },
        $set: { 'providerIdentifiers.accessibleCustomerIds': [] },
      },
    );

    const ctx = await resolveGoogleAdsCapabilityContext({ businessId: sandbox.businessId });
    expect(ctx.ok).toBe(false);
    expect(ctx.errorCode).toBe('SELECTION_REQUIRED');
  });
});
