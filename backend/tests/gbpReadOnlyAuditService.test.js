'use strict';

jest.mock('../services/integrations/gbpProfileReadClient', () => {
  const actual = jest.requireActual('../services/integrations/gbpProfileReadClient');
  return {
    ...actual,
    fetchGbpProfileReadModel: jest.fn((...args) => actual.fetchGbpProfileReadModel(...args)),
  };
});

const mongoose = require('mongoose');
const {
  runGbpReadOnlyAudit,
  computeFindings,
  GbpProviderPreconditionError,
  buildGbpMissingGuidance,
} = require('../services/capabilities/gbpReadOnlyAuditService');
const {
  GbpApiError,
  normalizeGbpLocation,
  fetchGbpProfileReadModel,
  fetchGbpProfileReadModelMock,
} = require('../services/integrations/gbpProfileReadClient');
const { createLogger } = require('../lib/observability/logger');

describe('gbpReadOnlyAuditService', () => {
  const logger = createLogger({ level: 'silent' });

  it('persists ProviderSnapshot and AuditReport idempotently', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const AuditReport = mongoose.model('AuditReport');
    const ProviderSnapshot = mongoose.model('ProviderSnapshot');

    const user = await User.create({ email: 'gbp-idem@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      businessName: 'Acme',
      websiteUrl: 'https://acme.example',
      industry: 'Plumber',
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });

    await runGbpReadOnlyAudit({ setupRunId: run._id, businessId: bc.businessId, logger });
    await runGbpReadOnlyAudit({ setupRunId: run._id, businessId: bc.businessId, logger });

    expect(await ProviderSnapshot.countDocuments({ setupRunId: run._id })).toBe(1);
    expect(await AuditReport.countDocuments({ setupRunId: run._id })).toBe(1);
  });

  it('marks missing fields when GBP profile lacks data', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const IntegrationConnection = mongoose.model('IntegrationConnection');

    const user = await User.create({ email: 'gbp-miss@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'gbp',
      connectionHealth: 'connected',
      providerIdentifiers: {
        mockProfile: {
          businessName: '',
          websiteUrl: '',
          primaryCategory: '',
          phoneNumber: '',
          serviceAreas: [],
          openingHoursPresent: false,
        },
      },
    });

    const result = await runGbpReadOnlyAudit({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(result.summary.missingCount).toBeGreaterThan(0);
    expect(result.findings.missing.some((f) => f.includes('Business name'))).toBe(true);
  });

  it('marks needsAttention on mismatch between context and GBP', () => {
    const findings = computeFindings(
      { businessName: 'Acme Co', websiteUrl: 'https://acme.example', industry: 'Plumber' },
      {
        profile: {
          businessName: 'Acme LLC',
          websiteUrl: 'https://other.example',
          primaryCategory: 'Electrician',
          phoneNumber: null,
          serviceAreas: [],
          openingHoursPresent: false,
        },
      }
    );

    expect(findings.needsAttention.some((f) => f.includes('Business name'))).toBe(true);
    expect(findings.needsAttention.some((f) => f.includes('Website URL'))).toBe(true);
    expect(findings.needsAttention.some((f) => f.includes('Primary category'))).toBe(true);
  });

  it('does not create IntegrationArtifact rows', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');

    const user = await User.create({ email: 'gbp-no-art@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      businessName: 'Acme',
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });

    await runGbpReadOnlyAudit({ setupRunId: run._id, businessId: bc.businessId, logger });

    expect(await IntegrationArtifact.countDocuments({ setupRunId: run._id, provider: 'gbp' })).toBe(
      0
    );
  });

  it('throws when BusinessContext is missing', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const run = await SetupRun.create({
      businessId: new mongoose.Types.ObjectId(),
      status: 'RUNNING',
    });

    await expect(
      runGbpReadOnlyAudit({
        setupRunId: run._id,
        businessId: run.businessId,
        logger,
      })
    ).rejects.toThrow(GbpProviderPreconditionError);
  });

  it('throws when GBP API is not enabled and mock is off', async () => {
    const prevMock = process.env.GBP_API_MOCK;
    const prevEnabled = process.env.GBP_API_ENABLED;
    delete process.env.GBP_API_MOCK;
    delete process.env.GBP_API_ENABLED;

    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const user = await User.create({ email: 'gbp-noapi@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });

    await expect(
      runGbpReadOnlyAudit({ setupRunId: run._id, businessId: bc.businessId, logger })
    ).rejects.toThrow(/GBP API is not enabled/);

    process.env.GBP_API_MOCK = prevMock;
    process.env.GBP_API_ENABLED = prevEnabled;
  });

  async function seedGbpConnection(businessId, discoveryReason) {
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    await IntegrationConnection.create({
      businessId,
      provider: 'gbp',
      connectionHealth: 'connected',
      accessTokenEnc: 'x',
      refreshTokenEnc: 'y',
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: ['https://www.googleapis.com/auth/business.manage'],
      providerIdentifiers: { discoveryReason },
    });
  }

  it('returns guidance for GBP_NO_ACCOUNTS without throwing', async () => {
    const prevMock = process.env.GBP_API_MOCK;
    const prevEnabled = process.env.GBP_API_ENABLED;
    process.env.GBP_API_MOCK = 'false';
    process.env.GBP_API_ENABLED = 'true';

    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const AuditReport = mongoose.model('AuditReport');
    const ProviderSnapshot = mongoose.model('ProviderSnapshot');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');

    const user = await User.create({ email: 'gbp-no-acct@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });
    await seedGbpConnection(bc.businessId, 'GBP_NO_ACCOUNTS');

    const result = await runGbpReadOnlyAudit({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('GBP_NO_ACCOUNTS');
    expect(result.guidance).toEqual(buildGbpMissingGuidance('GBP_NO_ACCOUNTS'));
    expect(result.blocking).toBe(false);
    expect(result.source).toBe('gbp_missing');

    const snapshot = await ProviderSnapshot.findOne({ setupRunId: run._id }).lean();
    expect(snapshot?.payload?.source).toBe('gbp_missing');
    expect(snapshot?.payload?.reason).toBe('GBP_NO_ACCOUNTS');

    const audit = await AuditReport.findOne({ setupRunId: run._id }).lean();
    expect(audit?.findings?.needsAttention).toHaveLength(1);
    expect(await IntegrationArtifact.countDocuments({ setupRunId: run._id, provider: 'gbp' })).toBe(0);

    process.env.GBP_API_MOCK = prevMock;
    process.env.GBP_API_ENABLED = prevEnabled;
  });

  it('returns guidance for GBP_NO_LOCATIONS without throwing', async () => {
    const prevMock = process.env.GBP_API_MOCK;
    const prevEnabled = process.env.GBP_API_ENABLED;
    process.env.GBP_API_MOCK = 'false';
    process.env.GBP_API_ENABLED = 'true';

    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');

    const user = await User.create({ email: 'gbp-no-loc@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });
    await seedGbpConnection(bc.businessId, 'GBP_NO_LOCATIONS');

    const result = await runGbpReadOnlyAudit({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('GBP_NO_LOCATIONS');
    expect(result.guidance).toEqual(buildGbpMissingGuidance('GBP_NO_LOCATIONS'));
    expect(result.blocking).toBe(false);

    process.env.GBP_API_MOCK = prevMock;
    process.env.GBP_API_ENABLED = prevEnabled;
  });

  it('returns guidance for GBP_ACCOUNTS_FETCH_FAILED without throwing', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const AuditReport = mongoose.model('AuditReport');
    const ProviderSnapshot = mongoose.model('ProviderSnapshot');

    const user = await User.create({ email: 'gbp-fetch-429@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });

    fetchGbpProfileReadModel.mockRejectedValueOnce(
      new GbpApiError('GBP accounts list failed (429)', 'GBP_ACCOUNTS_FETCH_FAILED')
    );

    const result = await runGbpReadOnlyAudit({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('GBP_ACCOUNTS_FETCH_FAILED');
    expect(result.guidance).toEqual(buildGbpMissingGuidance('GBP_ACCOUNTS_FETCH_FAILED'));
    expect(result.blocking).toBe(false);
    expect(result.source).toBe('gbp_missing');

    const snapshot = await ProviderSnapshot.findOne({ setupRunId: run._id }).lean();
    expect(snapshot?.payload?.source).toBe('gbp_missing');
    expect(snapshot?.payload?.reason).toBe('GBP_ACCOUNTS_FETCH_FAILED');

    const audit = await AuditReport.findOne({ setupRunId: run._id }).lean();
    expect(audit?.findings?.needsAttention).toHaveLength(1);
  });
});

describe('gbpProfileReadClient', () => {
  it('normalizeGbpLocation maps API location fields', () => {
    const normalized = normalizeGbpLocation({
      title: 'Acme Plumbing',
      websiteUri: 'https://acme.example',
      categories: { primaryCategory: { displayName: 'Plumber' } },
      phoneNumbers: { primaryPhone: '+15551234567' },
      serviceArea: { places: { placeInfos: [{ placeName: 'Austin' }] } },
      regularHours: { periods: [{ openDay: 'MONDAY' }] },
    });

    expect(normalized.businessName).toBe('Acme Plumbing');
    expect(normalized.websiteUrl).toBe('https://acme.example');
    expect(normalized.primaryCategory).toBe('Plumber');
    expect(normalized.phoneNumber).toBe('+15551234567');
    expect(normalized.serviceAreas).toEqual(['Austin']);
    expect(normalized.openingHoursPresent).toBe(true);
  });

  it('fetchGbpProfileReadModelMock labels source explicitly', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const user = await User.create({ email: 'gbp-mock@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      businessName: 'Mock Co',
    });

    const readModel = await fetchGbpProfileReadModelMock(bc.businessId);
    expect(readModel.source).toBe('gbp_api_mock');
    expect(readModel.profile.businessName).toBe('Mock Co');
  });
});
