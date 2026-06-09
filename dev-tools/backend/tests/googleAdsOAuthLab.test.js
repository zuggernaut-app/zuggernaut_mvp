'use strict';

const { mongoose } = require('../shared');
require('../shared');
const {
  runOAuthTrace,
  runReadWriteTests,
  formatOAuthTraceReport,
  traceEnvironment,
  traceStoredConnection,
  buildMinimalSearchCampaignCreate,
  parseGoogleAdsFailure,
} = require('../lib/dev/googleAdsOAuthLab');

const { createBareUser } = require('../../../backend/tests/helpers');
const BusinessContext = mongoose.model('BusinessContext');
const IntegrationConnection = mongoose.model('IntegrationConnection');

describe('googleAdsOAuthLab', () => {
  const prevEnv = { ...process.env };

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.JWT_SECRET = 'x'.repeat(32);
    process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.GOOGLE_ADS_API_ENABLED = 'true';
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-token';
    process.env.GOOGLE_OAUTH_MOCK = 'true';
    process.env.GOOGLE_ADS_API_MOCK = 'true';
  });

  afterEach(() => {
    process.env = { ...prevEnv };
  });

  it('traceEnvironment reports missing vars', () => {
    delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    const result = traceEnvironment();
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('GOOGLE_ADS_DEVELOPER_TOKEN missing');
  });

  it('runOAuthTrace fails for unknown businessId', async () => {
    const report = await runOAuthTrace('000000000000000000000001', null);
    expect(report.stages.find((s) => s.id === 'business_context')?.ok).toBe(false);
    expect(report.firstFailure?.id).toBe('business_context');
    expect(formatOAuthTraceReport(report)).toContain('FIRST FAILURE');
  });

  it('runOAuthTrace reports stored connection when tokens exist', async () => {
    const user = await createBareUser('oauth-lab@test.com');
    const businessId = new mongoose.Types.ObjectId();
    await BusinessContext.create({
      businessId,
      userId: user._id,
      businessName: 'OAuth Lab Sandbox',
      confirmedAt: new Date(),
    });
    await IntegrationConnection.create({
      businessId,
      provider: 'google_ads',
      connectionHealth: 'selection_required',
      accessTokenEnc: 'enc',
      refreshTokenEnc: 'refresh',
      scopes: ['https://www.googleapis.com/auth/adwords'],
    });

    const stored = await traceStoredConnection(businessId.toString());
    expect(stored.ok).toBe(true);
    expect(stored.data?.hasAccessToken).toBe(true);

    const report = await runOAuthTrace(businessId.toString(), user._id.toString());
    const storedStage = report.stages.find((s) => s.id === 'stored_connection');
    expect(storedStage?.ok).toBe(true);
    expect(report.oauthLikelyComplete).toBe(true);
  });

  it('runMccLinkFlow requires client customer id when manager is provided', async () => {
    const { encryptToken } = require('../../../backend/lib/crypto/tokenEncryption');
    const user = await createBareUser('oauth-lab-mcc@test.com');
    const businessId = new mongoose.Types.ObjectId();
    await BusinessContext.create({
      businessId,
      userId: user._id,
      businessName: 'OAuth Lab MCC',
      confirmedAt: new Date(),
    });
    await IntegrationConnection.create({
      businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('mock-access'),
      refreshTokenEnc: encryptToken('mock-refresh'),
      scopes: ['https://www.googleapis.com/auth/adwords'],
    });

    const { runMccLinkFlow } = require('../lib/dev/googleAdsOAuthLab');
    const result = await runMccLinkFlow(businessId.toString(), {
      managerCustomerId: '2940178860',
    });
    expect(result.linkReady).toBe(false);
    expect(result.stages.some((s) => s.id === 'resolve_manager_client' && !s.ok)).toBe(true);
  });

  it('buildMinimalSearchCampaignCreate includes v24 required fields', () => {
    const payload = buildMinimalSearchCampaignCreate({
      name: 'ZUG_TEST',
      campaignBudget: 'customers/123/campaignBudgets/1',
    });
    expect(payload.containsEuPoliticalAdvertising).toBe('DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING');
    expect(payload.manualCpc).toEqual({ enhancedCpcEnabled: false });
    expect(payload.networkSettings.targetSearchNetwork).toBe(true);
  });

  it('parseGoogleAdsFailure extracts fieldPath from GoogleAdsFailure details', () => {
    const parsed = parseGoogleAdsFailure({
      error: {
        status: 'INVALID_ARGUMENT',
        message: 'Request contains an invalid argument.',
        details: [
          {
            '@type': 'type.googleapis.com/google.ads.googleads.v24.errors.GoogleAdsFailure',
            errors: [
              {
                message: 'The required field was not present.',
                location: {
                  fieldPathElements: [{ fieldName: 'operations' }, { fieldName: 'create', index: 0 }, { fieldName: 'contains_eu_political_advertising' }],
                },
              },
            ],
          },
        ],
      },
    });
    expect(parsed.fieldPath).toContain('contains_eu_political_advertising');
  });

  it('runReadWriteTests returns missing connection without tokens', async () => {
    const user = await createBareUser('oauth-lab-rw@test.com');
    const businessId = new mongoose.Types.ObjectId();
    await BusinessContext.create({
      businessId,
      userId: user._id,
      businessName: 'OAuth Lab RW',
      confirmedAt: new Date(),
    });

    const result = await runReadWriteTests(businessId.toString());
    expect(result.ok).toBe(false);
    expect(result.linkReady).toBe(false);
    expect(result.message).toContain('Connect google_ads OAuth');
  });

  it('runReadWriteTests read mode checks link then runs read steps only', async () => {
    const { encryptToken } = require('../../../backend/lib/crypto/tokenEncryption');
    const user = await createBareUser('oauth-lab-read@test.com');
    const businessId = new mongoose.Types.ObjectId();
    await BusinessContext.create({
      businessId,
      userId: user._id,
      businessName: 'OAuth Lab Read',
      confirmedAt: new Date(),
    });
    await IntegrationConnection.create({
      businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('mock-access'),
      refreshTokenEnc: encryptToken('mock-refresh'),
      scopes: ['https://www.googleapis.com/auth/adwords'],
    });

    const result = await runReadWriteTests(businessId.toString(), {
      managerCustomerId: '2940178860',
      customerId: '7809414862',
      mode: 'read',
    });

    expect(result.mode).toBe('read');
    expect(result.linkReady).toBe(true);
    expect(result.stages.find((s) => s.id === 'check_mcc_link')?.ok).toBe(true);
    expect(result.stages.some((s) => s.id === 'read_customer_metadata')).toBe(true);
    expect(result.stages.some((s) => s.id === 'read_campaigns')).toBe(true);
    expect(result.stages.some((s) => s.id === 'write_campaign_budget')).toBe(false);
  });
});
