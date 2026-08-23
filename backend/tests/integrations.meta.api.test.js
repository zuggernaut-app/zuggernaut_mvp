'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../app');
const { registerAgent } = require('./helpers');

describe('meta integrations API', () => {
  const app = createApp();
  const BusinessContext = mongoose.model('BusinessContext');
  const Org = mongoose.model('Org');
  const Membership = mongoose.model('Membership');
  const User = mongoose.model('User');

  beforeEach(() => {
    process.env.META_API_MOCK = 'true';
    process.env.META_OAUTH_MOCK = 'true';
  });

  it('returns meta connect url for authenticated user', async () => {
    const { agent } = await registerAgent(app, 'meta-url@example.com');
    const res = await agent.get('/api/v1/integrations/meta/connect-url').expect(200);
    expect(res.body.url).toMatch(/meta\.example/);
  });

  it('runs meta setup for business member', async () => {
    const { agent, userId } = await registerAgent(app, 'meta-setup@example.com');
    const org = await Org.create({ name: 'Meta Org', ownerUserId: new mongoose.Types.ObjectId(userId) });
    await Membership.create({
      orgId: org._id,
      userId: new mongoose.Types.ObjectId(userId),
      role: 'owner',
    });
    const bc = await BusinessContext.create({
      userId: new mongoose.Types.ObjectId(userId),
      orgId: org._id,
      businessName: 'Meta Biz',
      confirmedAt: new Date(),
    });

    const res = await agent
      .post('/api/v1/integrations/meta/setup')
      .send({ businessId: bc.businessId.toString() })
      .expect(200);

    expect(res.body.step).toBe('meta_setup_v1');
  });
});
