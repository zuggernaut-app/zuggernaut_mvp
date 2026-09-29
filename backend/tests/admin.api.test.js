'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../app');
const { registerAgent } = require('./helpers');

describe('admin API', () => {
  const app = createApp();
  const User = mongoose.model('User');

  it('returns 403 for non-admin', async () => {
    const { agent } = await registerAgent(app, 'not-admin@example.com');
    await agent.get('/api/v1/admin/users').expect(403);
  });

  it('lists users for platform admin', async () => {
    const { agent, userId } = await registerAgent(app, 'platform-admin@example.com');
    await User.findByIdAndUpdate(userId, { $set: { platformAdmin: true } });

    const res = await agent.get('/api/v1/admin/users').expect(200);
    expect(Array.isArray(res.body.users)).toBe(true);
  });

  it('returns 403 for non-admin fact-check', async () => {
    const BusinessContext = mongoose.model('BusinessContext');
    const { agent, userId } = await registerAgent(app, 'not-admin-fact@example.com');
    const bc = await BusinessContext.create({
      userId: new mongoose.Types.ObjectId(userId),
      businessName: 'Fact Check Biz',
    });
    await agent
      .patch(`/api/v1/admin/businesses/${bc.businessId.toString()}/fact-check`)
      .send({ businessName: 'Updated' })
      .expect(403);
  });

  it('returns setup run report for platform admin', async () => {
    const SetupRun = mongoose.model('SetupRun');
    const BusinessContext = mongoose.model('BusinessContext');
    const { agent, userId } = await registerAgent(app, 'platform-admin-report@example.com');
    await User.findByIdAndUpdate(userId, { $set: { platformAdmin: true } });

    const bc = await BusinessContext.create({
      userId: new mongoose.Types.ObjectId(userId),
      businessName: 'Admin Report Biz',
      confirmedAt: new Date(),
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'SUCCEEDED' });

    const res = await agent.get(`/api/v1/admin/setup-runs/${run._id.toString()}/report`).expect(200);
    expect(res.body.report).toBeTruthy();
    expect(res.body.report.setupRun.id).toBe(run._id.toString());
  });
});
