'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../app');
const { registerAgent } = require('./helpers');
const { encryptToken } = require('../lib/crypto/tokenEncryption');

describe('integrations ads performance API', () => {
  const app = createApp();
  const BusinessContext = mongoose.model('BusinessContext');
  const IntegrationArtifact = mongoose.model('IntegrationArtifact');
  const IntegrationConnection = mongoose.model('IntegrationConnection');

  it('GET /google_ads/campaign/performance returns metrics', async () => {
    process.env.GOOGLE_ADS_API_MOCK = 'true';
    const email = 'perf-api@example.com';
    const { agent, userId } = await registerAgent(app, email);
    const bc = await BusinessContext.create({
      userId: new mongoose.Types.ObjectId(userId),
      businessName: 'Perf API',
      confirmedAt: new Date(),
    });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('ads-access'),
      refreshTokenEnc: encryptToken('ads-refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: ['https://www.googleapis.com/auth/adwords'],
      providerIdentifiers: { customerId: '1234567890' },
    });
    await IntegrationArtifact.create({
      businessId: bc.businessId,
      setupRunId: new mongoose.Types.ObjectId(),
      provider: 'google_ads',
      artifactType: 'ads_campaign',
      externalId: 'customers/1234567890/campaigns/1',
    });

    const res = await agent
      .get(`/api/v1/integrations/google_ads/campaign/performance?businessId=${bc.businessId}`)
      .expect(200);

    expect(res.body.performance.metrics.impressions).toBe(1200);
  });

  it('GET /google_ads/campaign/performance returns metrics for org member', async () => {
    process.env.GOOGLE_ADS_API_MOCK = 'true';
    const Org = mongoose.model('Org');
    const Membership = mongoose.model('Membership');
    const { userId: ownerId } = await registerAgent(app, 'perf-api-owner@example.com');
    const { agent: memberAgent } = await registerAgent(app, 'perf-api-member@example.com');
    const org = await Org.create({
      name: 'Perf Org',
      ownerUserId: new mongoose.Types.ObjectId(ownerId),
    });
    const memberUserId = new mongoose.Types.ObjectId(
      (await mongoose.model('User').findOne({ email: 'perf-api-member@example.com' }).select('_id').lean())._id
    );
    await Membership.create({ orgId: org._id, userId: memberUserId, role: 'member' });
    const bc = await BusinessContext.create({
      userId: new mongoose.Types.ObjectId(ownerId),
      orgId: org._id,
      businessName: 'Org Perf API',
      confirmedAt: new Date(),
    });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('ads-access'),
      refreshTokenEnc: encryptToken('ads-refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: ['https://www.googleapis.com/auth/adwords'],
      providerIdentifiers: { customerId: '1234567890' },
    });
    await IntegrationArtifact.create({
      businessId: bc.businessId,
      setupRunId: new mongoose.Types.ObjectId(),
      provider: 'google_ads',
      artifactType: 'ads_campaign',
      externalId: 'customers/1234567890/campaigns/1',
    });

    const res = await memberAgent
      .get(`/api/v1/integrations/google_ads/campaign/performance?businessId=${bc.businessId}`)
      .expect(200);

    expect(res.body.performance.metrics.impressions).toBe(1200);
  });
});
