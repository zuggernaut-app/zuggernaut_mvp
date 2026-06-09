'use strict';

const mongoose = require('mongoose');
require('../models');
const { runOAuthTrace, runReadTests } = require('../lib/dev/gbpOAuthLab');
const { createBareUser } = require('./helpers');
const BusinessContext = mongoose.model('BusinessContext');
const IntegrationConnection = mongoose.model('IntegrationConnection');

describe('gbpOAuthLab', () => {
  const prevEnv = { ...process.env };

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.JWT_SECRET = 'x'.repeat(32);
    process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.GBP_API_ENABLED = 'true';
    process.env.GBP_API_MOCK = 'true';
    process.env.GOOGLE_OAUTH_MOCK = 'true';
  });

  afterEach(() => {
    process.env = { ...prevEnv };
  });

  it('runOAuthTrace fails for unknown businessId', async () => {
    const report = await runOAuthTrace('000000000000000000000001', null);
    expect(report.stages.find((s) => s.id === 'business_context')?.ok).toBe(false);
    expect(report.firstFailure?.id).toBe('business_context');
  });

  it('runReadTests succeeds with mock GBP profile', async () => {
    const { encryptToken } = require('../lib/crypto/tokenEncryption');
    const user = await createBareUser('gbp-lab-read@test.com');
    const businessId = new mongoose.Types.ObjectId();
    await BusinessContext.create({
      businessId,
      userId: user._id,
      businessName: 'GBP Lab Read',
      confirmedAt: new Date(),
      websiteUrl: 'https://example.com',
      industry: 'Test',
      serviceAreas: ['Test'],
    });
    await IntegrationConnection.create({
      businessId,
      provider: 'gbp',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('mock-access'),
      refreshTokenEnc: encryptToken('mock-refresh'),
      scopes: ['https://www.googleapis.com/auth/business.manage'],
      providerIdentifiers: {
        accountName: 'accounts/mock',
        locationName: 'accounts/mock/locations/mock',
      },
    });

    const result = await runReadTests(businessId.toString());

    expect(result.mode).toBe('read');
    expect(result.stages.find((s) => s.id === 'read_gbp_profile')?.ok).toBe(true);
    expect(result.locationReady).toBe(true);
  });
});
