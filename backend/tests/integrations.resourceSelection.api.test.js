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

  it('PUT Google Ads provisioning-intent rejects invalid businessId', async () => {
    const { agent } = await confirmedBusiness('ads-intent-invalid-bid@test.com');

    const res = await agent
      .put('/api/v1/integrations/google_ads/provisioning-intent')
      .send({
        businessId: 'not-an-object-id',
        provisioningIntent: 'mcc_create',
      })
      .expect(400);

    expect(res.body.error).toBe('validation_error');
    expect(res.body.message).toMatch(/businessId/i);
  });

  it('PUT Google Ads provisioning-intent rejects non-mcc_create intent', async () => {
    const { agent, bid } = await confirmedBusiness('ads-intent-invalid-intent@test.com');

    const res = await agent
      .put('/api/v1/integrations/google_ads/provisioning-intent')
      .send({
        businessId: bid,
        provisioningIntent: 'select_existing',
      })
      .expect(400);

    expect(res.body.error).toBe('validation_error');
    expect(res.body.message).toMatch(/provisioningIntent must be mcc_create/i);
  });

  it('PUT Google Ads provisioning-intent persists mcc_create intent', async () => {
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { agent, bid, userId } = await confirmedBusiness('ads-intent-save@test.com');

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
          connectionHealth: 'selection_required',
          providerIdentifiers: {
            accessibleCustomerIds: ['1234567890'],
            loginCustomerId: '3462198684',
          },
        },
      }
    );

    const saved = await agent
      .put('/api/v1/integrations/google_ads/provisioning-intent')
      .send({
        businessId: bid,
        provisioningIntent: 'mcc_create',
      })
      .expect(200);

    expect(saved.body.result.provider).toBe('google_ads');
    expect(saved.body.result.provisioningIntent).toBe('mcc_create');

    const conn = await IntegrationConnection.findOne({ businessId: bid, provider: 'google_ads' })
      .select('connectionHealth providerIdentifiers')
      .lean();

    expect(conn.connectionHealth).toBe('provisioning_required');
    expect(conn.providerIdentifiers.provisioningIntent).toBe('mcc_create');

    const status = await agent.get('/api/v1/integrations/status').query({ businessId: bid }).expect(200);
    expect(status.body.connections.google_ads.ready).toBe(false);
    expect(status.body.connections.google_ads.reason).toBe('provisioning_required');
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

  it('GET GTM accounts lists accounts without requiring container selection', async () => {
    const { agent, bid, userId } = await confirmedBusiness('gtm-accounts@test.com');

    await completeGoogleOAuthCallback({
      businessId: bid,
      provider: 'gtm',
      userId,
      code: 'mock',
    });

    const res = await agent.get('/api/v1/integrations/gtm/accounts').query({ businessId: bid }).expect(200);

    expect(res.body.result.provider).toBe('gtm');
    expect(res.body.result.accounts.length).toBeGreaterThan(0);
    expect(res.body.result.selectedAccountId).toBeNull();
  });

  it('PUT GTM account-selection stores account only with provisioning_required health', async () => {
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { agent, bid, userId } = await confirmedBusiness('gtm-account-sel@test.com');

    await completeGoogleOAuthCallback({
      businessId: bid,
      provider: 'gtm',
      userId,
      code: 'mock',
    });

    const saved = await agent
      .put('/api/v1/integrations/gtm/account-selection')
      .send({ businessId: bid, accountId: 'mock-account' })
      .expect(200);

    expect(saved.body.result.providerIdentifiers.accountId).toBe('mock-account');
    expect(saved.body.result.providerIdentifiers.containerId).toBeUndefined();

    const conn = await IntegrationConnection.findOne({ businessId: bid, provider: 'gtm' }).lean();
    expect(conn.connectionHealth).toBe('provisioning_required');
    expect(conn.providerIdentifiers.discoveryReason).toBe('GTM_PROVISIONING_REQUIRED');
  });

  it('returns 409 provider_selection_locked when setup succeeded and GTM selection changes', async () => {
    const BusinessSetupState = mongoose.model('BusinessSetupState');
    const { agent, bid, userId } = await confirmedBusiness('gtm-lock@test.com');

    await completeGoogleOAuthCallback({
      businessId: bid,
      provider: 'gtm',
      userId,
      code: 'mock',
    });

    await BusinessSetupState.findOneAndUpdate(
      { businessId: bid },
      { $set: { lockState: 'succeeded' } },
      { upsert: true }
    );

    const res = await agent
      .put('/api/v1/integrations/gtm/selection')
      .send({
        businessId: bid,
        accountId: 'mock-account',
        containerId: 'mock-container',
        workspaceId: 'mock-workspace',
      })
      .expect(409);

    expect(res.body.error).toBe('provider_selection_locked');
  });

  it('returns 409 provider_resource_in_use when GTM container is already bound to another business', async () => {
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const owner = await confirmedBusiness('gtm-excl-owner@test.com');
    const other = await confirmedBusiness('gtm-excl-other@test.com');

    await completeGoogleOAuthCallback({
      businessId: owner.bid,
      provider: 'gtm',
      userId: owner.userId,
      code: 'mock',
    });

    await IntegrationConnection.findOneAndUpdate(
      { businessId: owner.bid, provider: 'gtm' },
      {
        $set: {
          connectionHealth: 'connected',
          providerIdentifiers: {
            accountId: 'mock-account',
            containerId: 'mock-container',
            workspaceId: 'mock-workspace',
            publicContainerId: 'GTM-MOCK',
          },
        },
      }
    );

    await completeGoogleOAuthCallback({
      businessId: other.bid,
      provider: 'gtm',
      userId: other.userId,
      code: 'mock',
    });

    const res = await other.agent
      .put('/api/v1/integrations/gtm/selection')
      .send({
        businessId: other.bid,
        accountId: 'mock-account',
        containerId: 'mock-container',
        workspaceId: 'mock-workspace',
      })
      .expect(409);

    expect(res.body.error).toBe('provider_resource_in_use');
  });
});
