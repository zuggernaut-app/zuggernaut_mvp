'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../app');
const { registerAgent } = require('./helpers');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { allScopesForProvider } = require('../constants/googleOAuth');

describe('integrations MCC link API', () => {
  const app = createApp();
  const managerId = '3462198684';
  const clientId = '1234567890';

  beforeEach(() => {
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = managerId;
    process.env.GOOGLE_ADS_API_MOCK = 'true';
    process.env.GOOGLE_OAUTH_MOCK = 'true';
    process.env.GOOGLE_ADS_MCC_REFRESH_TOKEN = 'mock-mcc-refresh';
  });

  async function confirmedBusiness(email) {
    const { agent } = await registerAgent(app, email);
    const draft = await agent.post('/api/v1/onboarding/business').expect(201);
    const bid = draft.body.businessId;
    await agent.put(`/api/v1/business-contexts/${bid}`).send({ businessName: 'Co' }).expect(200);
    return { agent, bid };
  }

  async function seedGoogleAdsConnection(businessId) {
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    await IntegrationConnection.create({
      businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: allScopesForProvider('google_ads'),
      providerIdentifiers: {
        customerId: clientId,
        loginCustomerId: managerId,
        managerCustomerId: managerId,
      },
    });
  }

  it('returns 401 for mcc-link-status without auth', async () => {
    await request(app)
      .get('/api/v1/integrations/google_ads/mcc-link-status')
      .query({ businessId: new mongoose.Types.ObjectId().toString() })
      .expect(401);
  });

  it('returns 404 for mcc-link-status when user does not own business', async () => {
    const { bid } = await confirmedBusiness('mcc-deny@test.com');
    const { agent: other } = await registerAgent(app, 'mcc-other@test.com');
    await other
      .get('/api/v1/integrations/google_ads/mcc-link-status')
      .query({ businessId: bid })
      .expect(404);
  });

  it('invite is idempotent and returns manual accept instructions', async () => {
    const { agent, bid } = await confirmedBusiness('mcc-invite@test.com');
    await seedGoogleAdsConnection(bid);

    const first = await agent
      .post('/api/v1/integrations/google_ads/mcc-link/invite')
      .send({ businessId: bid })
      .expect(200);
    expect(first.body.manualAccept.steps.length).toBeGreaterThan(0);
    expect(JSON.stringify(first.body)).not.toMatch(/refreshToken|accessToken/i);

    const second = await agent
      .post('/api/v1/integrations/google_ads/mcc-link/invite')
      .send({ businessId: bid })
      .expect(200);
    expect(['active', 'pending']).toContain(second.body.outcome);
  });

  it('refresh status returns ACTIVE in mock mode', async () => {
    const { agent, bid } = await confirmedBusiness('mcc-refresh@test.com');
    await seedGoogleAdsConnection(bid);

    const res = await agent
      .get('/api/v1/integrations/google_ads/mcc-link-status')
      .query({ businessId: bid, refresh: 'true' })
      .expect(200);

    expect(res.body.mccLink.status).toBe('ACTIVE');
    expect(res.body.refreshed).toBe(true);
  });

  it('accept returns manual_accept_required when auto accept disabled', async () => {
    const { agent, bid } = await confirmedBusiness('mcc-accept@test.com');
    await seedGoogleAdsConnection(bid);

    const res = await agent
      .post('/api/v1/integrations/google_ads/mcc-link/accept')
      .send({ businessId: bid })
      .expect(409);

    expect(res.body.error).toBe('manual_accept_required');
  });
});
