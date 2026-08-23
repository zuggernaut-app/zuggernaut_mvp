'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../app');
const { registerAgent } = require('./helpers');

describe('GET /api/v1/business-contexts', () => {
  const app = createApp();
  const BusinessContext = mongoose.model('BusinessContext');

  it('lists business contexts for authenticated user', async () => {
    const { agent, userId } = await registerAgent(app, 'list-bc@example.com');
    await BusinessContext.create({ userId: new mongoose.Types.ObjectId(userId), businessName: 'A' });
    await BusinessContext.create({ userId: new mongoose.Types.ObjectId(userId), businessName: 'B' });

    const res = await agent.get('/api/v1/business-contexts').expect(200);
    expect(res.body.businessContexts.length).toBe(2);
  });

  it('lists org businesses for invited member', async () => {
    const Org = mongoose.model('Org');
    const Membership = mongoose.model('Membership');

    const { userId: ownerId } = await registerAgent(app, 'list-bc-owner@example.com');
    const { agent: memberAgent } = await registerAgent(app, 'list-bc-member@example.com');
    const org = await Org.create({ name: 'List Org', ownerUserId: new mongoose.Types.ObjectId(ownerId) });
    const memberUserId = new mongoose.Types.ObjectId(
      (await mongoose.model('User').findOne({ email: 'list-bc-member@example.com' }).select('_id').lean())._id
    );
    await Membership.create({ orgId: org._id, userId: memberUserId, role: 'member' });
    await BusinessContext.create({
      userId: new mongoose.Types.ObjectId(ownerId),
      orgId: org._id,
      businessName: 'Org Biz',
    });

    const res = await memberAgent.get('/api/v1/business-contexts').expect(200);
    expect(res.body.businessContexts.length).toBe(1);
    expect(res.body.businessContexts[0].businessName).toBe('Org Biz');
  });
});
