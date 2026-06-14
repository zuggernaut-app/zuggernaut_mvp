'use strict';

const mongoose = require('mongoose');
const { createApp } = require('../app');
const { registerAgent } = require('./helpers');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { completeGoogleOAuthCallback } = require('../services/integrations/googleOAuthService');

describe('integrations resource selection API', () => {
  const app = createApp();

  async function confirmedBusiness(email) {
    const { agent, userId } = await registerAgent(app, email);
    const draft = await agent.post('/api/v1/onboarding/business').expect(201);
    const bid = draft.body.businessId;
    await agent.put(`/api/v1/business-contexts/${bid}`).send({ businessName: 'Co' }).expect(200);
    return { agent, bid, userId };
  }

  it('GET GTM resource options requires auth', async () => {
    await registerAgent(app, 'no-auth@test.com');
    await require('supertest')(app)
      .get('/api/v1/integrations/gtm/resource-options')
      .query({ businessId: new mongoose.Types.ObjectId().toString() })
      .expect(401);
  });

  it('GET GTM resource options for connected OAuth', async () => {
    const { agent, bid, userId } = await confirmedBusiness('gtm-api@test.com');

    await completeGoogleOAuthCallback({
      businessId: bid,
      provider: 'gtm',
      userId,
      code: 'mock',
    });

    const res = await agent
      .get('/api/v1/integrations/gtm/resource-options')
      .query({ businessId: bid })
      .expect(200);

    expect(res.body.result.provider).toBe('gtm');
    expect(res.body.result.selectionRequired).toBe(true);
    expect(res.body.result.accounts.length).toBeGreaterThan(0);
    expect(JSON.stringify(res.body)).not.toMatch(/accessToken|refreshToken/i);
  });

  it('PUT GTM selection persists identifiers and returns connected status', async () => {
    const { agent, bid, userId } = await confirmedBusiness('gtm-save@test.com');

    await completeGoogleOAuthCallback({
      businessId: bid,
      provider: 'gtm',
      userId,
      code: 'mock',
    });

    const saved = await agent
      .put('/api/v1/integrations/gtm/selection')
      .send({
        businessId: bid,
        accountId: 'mock-account',
        containerId: 'mock-container',
        workspaceId: 'mock-workspace',
      })
      .expect(200);

    expect(saved.body.result.selectionRequired).toBe(false);
    expect(saved.body.result.selected.workspaceId).toBe('mock-workspace');

    const status = await agent.get('/api/v1/integrations/status').query({ businessId: bid }).expect(200);
    expect(status.body.connections.gtm.ready).toBe(true);
  });

  it('GET Google Ads resource options for connected OAuth', async () => {
    const { agent, bid, userId } = await confirmedBusiness('ads-api@test.com');

    await completeGoogleOAuthCallback({
      businessId: bid,
      provider: 'google_ads',
      userId,
      code: 'mock',
    });

    const res = await agent
      .get('/api/v1/integrations/google_ads/resource-options')
      .query({ businessId: bid })
      .expect(200);

    expect(res.body.result.provider).toBe('google_ads');
    expect(res.body.result.selectionRequired).toBe(true);
    expect(res.body.result.options.length).toBeGreaterThan(0);
  });

  it('PUT Google Ads selection persists customerId', async () => {
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { agent, bid, userId } = await confirmedBusiness('ads-save@test.com');

    await completeGoogleOAuthCallback({
      businessId: bid,
      provider: 'google_ads',
      userId,
      code: 'mock',
    });

    await IntegrationConnection.findOneAndUpdate(
      { businessId: bid, provider: 'google_ads' },
      {
        $set: {
          providerIdentifiers: {
            accessibleCustomerIds: ['1234567890'],
            loginCustomerId: '3462198684',
          },
        },
      }
    );

    const saved = await agent
      .put('/api/v1/integrations/google_ads/selection')
      .send({
        businessId: bid,
        customerId: '1234567890',
      })
      .expect(200);

    expect(saved.body.result.selectionRequired).toBe(false);
    expect(saved.body.result.selected.customerId).toBe('1234567890');

    const status = await agent.get('/api/v1/integrations/status').query({ businessId: bid }).expect(200);
    expect(status.body.connections.google_ads.ready).toBe(true);
  });

  it('GET status with rediscover=true keeps saved Google Ads selection ready', async () => {
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { agent, bid, userId } = await confirmedBusiness('ads-rediscover@test.com');

    await completeGoogleOAuthCallback({
      businessId: bid,
      provider: 'google_ads',
      userId,
      code: 'mock',
    });

    await IntegrationConnection.findOneAndUpdate(
      { businessId: bid, provider: 'google_ads' },
      {
        $set: {
          providerIdentifiers: {
            accessibleCustomerIds: ['1234567890'],
            loginCustomerId: '3462198684',
          },
        },
      }
    );

    await agent
      .put('/api/v1/integrations/google_ads/selection')
      .send({
        businessId: bid,
        customerId: '1234567890',
      })
      .expect(200);

    const status = await agent
      .get('/api/v1/integrations/status')
      .query({ businessId: bid, rediscover: 'true' })
      .expect(200);

    expect(status.body.connections.google_ads.ready).toBe(true);
    expect(status.body.connections.google_ads.reason).toBe('ok');
    expect(status.body.connections.google_ads.providerIdentifiers.customerId).toBe('1234567890');
  });

  it('GET status with rediscover=true keeps saved GTM selection ready', async () => {
    const { agent, bid, userId } = await confirmedBusiness('gtm-rediscover@test.com');

    await completeGoogleOAuthCallback({
      businessId: bid,
      provider: 'gtm',
      userId,
      code: 'mock',
    });

    await agent
      .put('/api/v1/integrations/gtm/selection')
      .send({
        businessId: bid,
        accountId: 'mock-account',
        containerId: 'mock-container',
        workspaceId: 'mock-workspace',
      })
      .expect(200);

    const status = await agent
      .get('/api/v1/integrations/status')
      .query({ businessId: bid, rediscover: 'true' })
      .expect(200);

    expect(status.body.connections.gtm.ready).toBe(true);
    expect(status.body.connections.gtm.reason).toBe('ok');
    expect(status.body.connections.gtm.providerIdentifiers.workspaceId).toBe('mock-workspace');
  });

  it('denies resource options for another user business', async () => {
    const { bid, userId } = await confirmedBusiness('owner-sel@test.com');
    const { agent: otherAgent } = await registerAgent(app, 'other-sel@test.com');

    await completeGoogleOAuthCallback({
      businessId: bid,
      provider: 'gtm',
      userId,
      code: 'mock',
    });

    await otherAgent
      .get('/api/v1/integrations/gtm/resource-options')
      .query({ businessId: bid })
      .expect(404);
  });
});
