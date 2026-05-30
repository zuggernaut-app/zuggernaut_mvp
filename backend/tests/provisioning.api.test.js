'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../app');
const { registerAgent } = require('./helpers');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { allScopesForProvider } = require('../constants/googleOAuth');

describe('provisioning API', () => {
  const app = createApp();

  async function confirmedBusiness(email) {
    const { agent, userId } = await registerAgent(app, email);
    const draft = await agent.post('/api/v1/onboarding/business').expect(201);
    const bid = draft.body.businessId;
    await agent.put(`/api/v1/business-contexts/${bid}`).send({ businessName: 'Co' }).expect(200);
    return { agent, bid, userId };
  }

  async function seedProvisioningRequired(businessId, provider) {
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    await IntegrationConnection.create({
      businessId,
      provider,
      connectionHealth: 'provisioning_required',
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes:
        provider === 'gtm'
          ? allScopesForProvider('gtm')
          : ['https://www.googleapis.com/auth/adwords'],
      providerIdentifiers: {
        discoveryReason:
          provider === 'gtm' ? 'GTM_PROVISIONING_REQUIRED' : 'ADS_PROVISIONING_REQUIRED',
      },
    });
  }

  it('returns 401 without auth', async () => {
    await request(app)
      .get('/api/v1/integrations/provisioning')
      .query({ businessId: new mongoose.Types.ObjectId().toString() })
      .expect(401);
  });

  it('returns provisioning overview for owned business', async () => {
    const { agent, bid } = await confirmedBusiness('prov-overview@test.com');
    await seedProvisioningRequired(bid, 'gtm');

    const res = await agent.get('/api/v1/integrations/provisioning').query({ businessId: bid }).expect(200);

    expect(res.body.businessId).toBe(bid);
    expect(res.body.providers.gtm.provisioningRequired).toBe(true);
    expect(res.body.providers.gtm.connection.reason).toBe('provisioning_required');
    expect(JSON.stringify(res.body)).not.toMatch(/accessToken|refreshToken/i);
  });

  it('creates, approves, executes, and completes GTM provisioning flow', async () => {
    const { agent, bid } = await confirmedBusiness('prov-flow@test.com');
    await seedProvisioningRequired(bid, 'gtm');
    const run = await mongoose.model('SetupRun').create({
      businessId: new mongoose.Types.ObjectId(bid),
      status: 'RUNNING',
    });

    const created = await agent
      .post('/api/v1/integrations/provisioning/gtm/requests')
      .send({ businessId: bid, setupRunId: run._id.toString() })
      .expect(201);

    expect(created.body.request.status).toBe('pending_approval');
    const requestId = created.body.request.id;

    const approved = await agent
      .post(`/api/v1/integrations/provisioning/requests/${requestId}/approve`)
      .send({ businessId: bid })
      .expect(200);
    expect(approved.body.request.status).toBe('approved');

    const executed = await agent
      .post(`/api/v1/integrations/provisioning/requests/${requestId}/execute`)
      .send({ businessId: bid, setupRunId: run._id.toString() })
      .expect(200);

    expect(executed.body.result.providerIdentifiers.accountId).toBeTruthy();
    expect(executed.body.result.connectionHealth).toBe('connected');

    const status = await agent.get('/api/v1/integrations/status').query({ businessId: bid }).expect(200);
    expect(status.body.connections.gtm.ready).toBe(true);
  });

  it('returns existing active request on duplicate create', async () => {
    const { agent, bid } = await confirmedBusiness('prov-idem@test.com');
    await seedProvisioningRequired(bid, 'google_ads');

    const first = await agent
      .post('/api/v1/integrations/provisioning/google_ads/requests')
      .send({ businessId: bid })
      .expect(201);

    const second = await agent
      .post('/api/v1/integrations/provisioning/google_ads/requests')
      .send({ businessId: bid })
      .expect(200);

    expect(second.body.created).toBe(false);
    expect(second.body.request.id).toBe(first.body.request.id);
  });

  it('returns 409 when provisioning is not required', async () => {
    const { agent, bid } = await confirmedBusiness('prov-not-required@test.com');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    await IntegrationConnection.create({
      businessId: new mongoose.Types.ObjectId(bid),
      provider: 'gtm',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: allScopesForProvider('gtm'),
      providerIdentifiers: {
        accountId: 'acc-1',
        containerId: 'cont-1',
        workspaceId: 'ws-1',
      },
    });

    const res = await agent
      .post('/api/v1/integrations/provisioning/gtm/requests')
      .send({ businessId: bid })
      .expect(409);

    expect(res.body.error).toBe('PROVISIONING_NOT_REQUIRED');
  });

  it('denies access to other users business', async () => {
    const { bid } = await confirmedBusiness('prov-owner@test.com');
    const { agent: otherAgent } = await registerAgent(app, 'prov-other@test.com');

    await otherAgent
      .get('/api/v1/integrations/provisioning')
      .query({ businessId: bid })
      .expect(404);
  });

  it('cancels a pending request', async () => {
    const { agent, bid } = await confirmedBusiness('prov-cancel@test.com');
    await seedProvisioningRequired(bid, 'google_ads');

    const created = await agent
      .post('/api/v1/integrations/provisioning/google_ads/requests')
      .send({ businessId: bid })
      .expect(201);

    const cancelled = await agent
      .post(`/api/v1/integrations/provisioning/requests/${created.body.request.id}/cancel`)
      .send({ businessId: bid })
      .expect(200);

    expect(cancelled.body.request.status).toBe('cancelled');
  });
});
