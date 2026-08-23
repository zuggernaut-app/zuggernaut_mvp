'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../app');
const { registerAgent } = require('./helpers');

describe('GBP write API', () => {
  const app = createApp();
  const BusinessContext = mongoose.model('BusinessContext');
  const Org = mongoose.model('Org');
  const Membership = mongoose.model('Membership');
  const User = mongoose.model('User');

  beforeEach(() => {
    process.env.GBP_API_MOCK = 'true';
  });

  it('requires consent header', async () => {
    const { agent, userId } = await registerAgent(app, 'gbp-api@example.com');
    const org = await Org.create({ name: 'GBP API Org', ownerUserId: new mongoose.Types.ObjectId(userId) });
    await Membership.create({
      orgId: org._id,
      userId: new mongoose.Types.ObjectId(userId),
      role: 'owner',
    });
    const bc = await BusinessContext.create({
      userId: new mongoose.Types.ObjectId(userId),
      orgId: org._id,
      businessName: 'GBP API Biz',
      confirmedAt: new Date(),
    });

    await agent
      .post('/api/v1/integrations/gbp/primary/write')
      .send({ businessId: bc.businessId.toString(), action: 'post', post: { summary: 'Hi' } })
      .expect(400);
  });

  it('writes with consent header', async () => {
    const { agent, userId } = await registerAgent(app, 'gbp-api-ok@example.com');
    const org = await Org.create({ name: 'GBP API Org 2', ownerUserId: new mongoose.Types.ObjectId(userId) });
    await Membership.create({
      orgId: org._id,
      userId: new mongoose.Types.ObjectId(userId),
      role: 'owner',
    });
    const bc = await BusinessContext.create({
      userId: new mongoose.Types.ObjectId(userId),
      orgId: org._id,
      businessName: 'GBP API Biz 2',
      confirmedAt: new Date(),
    });

    const res = await agent
      .post('/api/v1/integrations/gbp/primary/write')
      .set('x-gbp-write-consent', 'true')
      .send({ businessId: bc.businessId.toString(), action: 'post', post: { summary: 'Hi' } })
      .expect(200);

    expect(res.body.result.outcome).toBe('created');
  });
});
