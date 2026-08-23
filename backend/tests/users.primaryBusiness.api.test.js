'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../app');
const { registerAgent } = require('./helpers');

describe('PUT /api/v1/users/primary-business', () => {
  const app = createApp();
  const User = mongoose.model('User');
  const BusinessContext = mongoose.model('BusinessContext');

  it('sets primaryBusinessId when user owns business', async () => {
    const { agent, userId } = await registerAgent(app, 'primary-bc@example.com');
    const bc = await BusinessContext.create({
      userId: new mongoose.Types.ObjectId(userId),
      businessName: 'Primary Co',
    });

    const res = await agent
      .put('/api/v1/users/primary-business')
      .send({ businessId: bc.businessId.toString() })
      .expect(200);

    expect(res.body.primaryBusinessId).toBe(bc.businessId.toString());

    const user = await User.findById(userId).lean();
    expect(user.primaryBusinessId.toString()).toBe(bc.businessId.toString());
  });
});
