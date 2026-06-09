'use strict';

const { mongoose } = require('../shared');
const { createBareUser } = require('../../../backend/tests/helpers');
const { completeGoogleOAuthCallback } = require('../../../backend/services/integrations/googleOAuthService');
const IntegrationConnection = mongoose.model('IntegrationConnection');
const {
  runDevIntegrationsFlowTrace,
  traceTemporalBoundary,
  traceOAuthPersistenceDiagnosis,
  traceFrontendConnectUrl,
  formatTraceReport,
  normalizeProvider,
  TRACEABLE_PROVIDERS,
} = require('../lib/dev/devIntegrationsFlowTrace');
const { ensureSandboxBusiness } = require('../services/dev/integrationDiagnosticsService');

describe('devIntegrationsFlowTrace', () => {
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

  it('supports google_ads, gtm, and gbp providers', () => {
    expect(TRACEABLE_PROVIDERS).toEqual(['google_ads', 'gtm', 'gbp']);
    expect(normalizeProvider('gtm')).toBe('gtm');
    expect(normalizeProvider('gbp')).toBe('gbp');
    expect(() => normalizeProvider('unknown')).toThrow(/Unsupported provider/);
  });

  it.each(['google_ads', 'gtm', 'gbp'])(
    'reports connect URL OK before Mongo connection exists (%s)',
    async (provider) => {
      const user = await createBareUser(`trace-pre-${provider}@test.com`);
      const sandbox = await ensureSandboxBusiness(user._id);

      const report = await runDevIntegrationsFlowTrace({
        provider,
        businessId: sandbox.businessId,
        userId: user._id.toString(),
      });

      const byId = Object.fromEntries(report.stages.map((s) => [s.id, s]));
      expect(report.provider).toBe(provider);
      expect(byId.environment.ok).toBe(true);
      expect(byId.token_crypto_pipeline.ok).toBe(true);
      expect(byId.business_context.ok).toBe(true);
      expect(byId.frontend_connect_url.ok).toBe(true);
      expect(byId.oauth_callback_parsing.ok).toBe(true);
      expect(byId.post_oauth_persistence.ok).toBe(false);
      expect(byId.oauth_persistence_diagnosis.data.verdict).toBe('oauth_not_completed');
      expect(byId.stored_token_pipeline.skipped).toBe(true);
      expect(byId.smoke_test.ok).toBe(false);
      expect(report.firstFailure?.id).toBe('post_oauth_persistence');
    },
  );

  it.each(['google_ads', 'gtm', 'gbp'])(
    'passes persistence and smoke stages after mock OAuth callback (%s)',
    async (provider) => {
      const user = await createBareUser(`trace-post-${provider}@test.com`);
      const sandbox = await ensureSandboxBusiness(user._id);

      await completeGoogleOAuthCallback({
        businessId: sandbox.businessId,
        provider,
        userId: user._id.toString(),
        code: 'mock-auth-code',
      });

      const report = await runDevIntegrationsFlowTrace({
        provider,
        businessId: sandbox.businessId,
        userId: user._id.toString(),
      });

      const byId = Object.fromEntries(report.stages.map((s) => [s.id, s]));
      expect(byId.post_oauth_persistence.ok).toBe(true);
      expect(byId.oauth_persistence_diagnosis.data.verdict).toBe('ok');
      expect(byId.smoke_test.ok).toBe(true);
      expect(report.firstFailure).toBeNull();
    },
  );

  it('includes provider-specific scopes in connect URL for gtm', async () => {
    const user = await createBareUser('trace-gtm-scope@test.com');
    const sandbox = await ensureSandboxBusiness(user._id);
    const stage = await traceFrontendConnectUrl('gtm', sandbox.businessId, user._id.toString());
    expect(stage.ok).toBe(true);
    expect(stage.data.requiredScopeFragment).toBe('tagmanager');
    expect(stage.data.scopeIncludesRequired).toBe(true);
  });

  it('includes provider-specific scopes in connect URL for gbp', async () => {
    const user = await createBareUser('trace-gbp-scope@test.com');
    const sandbox = await ensureSandboxBusiness(user._id);
    const stage = await traceFrontendConnectUrl('gbp', sandbox.businessId, user._id.toString());
    expect(stage.ok).toBe(true);
    expect(stage.data.requiredScopeFragment).toBe('business.manage');
    expect(stage.data.scopeIncludesRequired).toBe(true);
  });

  it('diagnoses wrong_business when tokens exist on another sandbox', async () => {
    const user = await createBareUser('trace-wrong-biz@test.com');
    const BusinessContext = mongoose.model('BusinessContext');
    const bcA = await BusinessContext.create({
      userId: user._id,
      businessName: 'Sandbox A',
      confirmedAt: new Date(),
    });
    const bcB = await BusinessContext.create({
      userId: user._id,
      businessName: 'Sandbox B',
      confirmedAt: new Date(),
    });

    await IntegrationConnection.create({
      businessId: bcA.businessId,
      provider: 'gtm',
      connectionHealth: 'connected',
      scopes: ['https://www.googleapis.com/auth/tagmanager.manage.accounts'],
      accessTokenEnc: 'enc',
      refreshTokenEnc: 'enc',
      tokenExpiryAt: new Date(Date.now() + 3600_000),
    });

    const stage = await traceOAuthPersistenceDiagnosis(
      'gtm',
      bcB.businessId.toString(),
      user._id.toString(),
    );

    expect(stage.data.verdict).toBe('wrong_business');
    expect(stage.data.completeGoogleOAuthCallbackLikelyCalled).toBe(true);
    expect(stage.data.connectionOnOtherBusinesses).toHaveLength(1);
  });

  it('diagnoses callback_failed when frontend reports token exchange error', async () => {
    const user = await createBareUser('trace-cb-fail@test.com');
    const sandbox = await ensureSandboxBusiness(user._id);

    const stage = await traceOAuthPersistenceDiagnosis('gbp', sandbox.businessId, user._id.toString(), {
      oauthOutcome: 'error',
      oauthReason: 'OAUTH_TOKEN_EXCHANGE_FAILED',
    });

    expect(stage.data.verdict).toBe('callback_failed');
    expect(stage.data.completeGoogleOAuthCallbackLikelyCalled).toBe(true);
  });

  it('temporal boundary documents OAuth does not start workflows', async () => {
    const stage = await traceTemporalBoundary('gtm', { probeTemporal: false });
    expect(stage.ok).toBe(true);
    const oauthPath = stage.data.paths.find((p) => p.action.includes('Connect OAuth'));
    const smokePath = stage.data.paths.find((p) => p.action === 'Smoke test');
    expect(oauthPath.startsTemporalWorkflow).toBe(false);
    expect(smokePath.startsTemporalWorkflow).toBe(false);
    expect(smokePath.service).toBe('discoverProviderConnection');
    expect(formatTraceReport({ provider: 'gtm', businessId: 'x', userId: 'y', stages: [stage] })).toContain(
      'Google Tag Manager',
    );
  });
});
