'use strict';

const { mongoose } = require('../shared');
require('../shared');
const { createBareUser } = require('../../../backend/tests/helpers');
const { encryptToken } = require('../../../backend/lib/crypto/tokenEncryption');
const { ensureSandboxBusiness } = require('../services/dev/integrationDiagnosticsService');
const { runGoogleAdsCreationDiagnostics } = require('../services/dev/googleAdsCreationDiagnosticsService');
const { getCreationDiagnosticSteps } = require('../lib/dev/creationDiagnosticsMatrix');

const IntegrationConnection = mongoose.model('IntegrationConnection');

describe('googleAdsCreationDiagnosticsService', () => {
  beforeEach(() => {
    process.env.GOOGLE_ADS_API_MOCK = 'true';
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
  });

  it('creates paused Google Ads resources for the full matrix in mock mode', async () => {
    const user = await createBareUser('ads-create-diag@test.com');
    const sandbox = await ensureSandboxBusiness(user._id);

    await IntegrationConnection.create({
      businessId: sandbox.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      scopes: ['https://www.googleapis.com/auth/adwords'],
      accessTokenEnc: 'enc',
      refreshTokenEnc: 'enc',
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      providerIdentifiers: {
        customerId: '1234567890',
        accessibleCustomerIds: ['1234567890'],
      },
    });

    const result = await runGoogleAdsCreationDiagnostics(sandbox.businessId, { mode: 'create_paused' });

    expect(result.provider).toBe('google_ads');
    expect(result.mode).toBe('create_paused');
    expect(result.steps).toHaveLength(getCreationDiagnosticSteps('google_ads').length);
    expect(result.steps.find((step) => step.name === 'search_campaign')).toMatchObject({
      ok: true,
      skipped: false,
    });
    expect(result.ok).toBe(true);
  });

  it('never creates an enabled campaign in validate_only mode', async () => {
    const user = await createBareUser('ads-create-diag-validate@test.com');
    const sandbox = await ensureSandboxBusiness(user._id);

    await IntegrationConnection.create({
      businessId: sandbox.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      scopes: ['https://www.googleapis.com/auth/adwords'],
      accessTokenEnc: 'enc',
      refreshTokenEnc: 'enc',
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      providerIdentifiers: { customerId: '1234567890' },
    });

    const result = await runGoogleAdsCreationDiagnostics(sandbox.businessId, { mode: 'validate_only' });

    expect(result.ok).toBe(true);
    expect(result.steps.every((step) => step.skipped)).toBe(true);
    expect(result.summary.skipped).toBe(getCreationDiagnosticSteps('google_ads').length);
  });

  it('returns INSUFFICIENT_SCOPES when adwords scope is missing', async () => {
    const user = await createBareUser('ads-create-diag-scopes@test.com');
    const sandbox = await ensureSandboxBusiness(user._id);

    await IntegrationConnection.create({
      businessId: sandbox.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      scopes: [],
      accessTokenEnc: encryptToken('mock-access-token'),
      refreshTokenEnc: encryptToken('mock-refresh-token'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      providerIdentifiers: { customerId: '1234567890' },
    });

    const result = await runGoogleAdsCreationDiagnostics(sandbox.businessId);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('INSUFFICIENT_SCOPES');
  });

  it('returns MISSING_CONNECTION when Google Ads is not connected', async () => {
    const user = await createBareUser('ads-create-diag-missing@test.com');
    const sandbox = await ensureSandboxBusiness(user._id);

    const result = await runGoogleAdsCreationDiagnostics(sandbox.businessId);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('MISSING_CONNECTION');
  });
});
