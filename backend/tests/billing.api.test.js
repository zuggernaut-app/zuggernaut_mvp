'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../app');
const { registerAgent, attachCsrfToAgent } = require('./helpers');

describe('/api/v1/billing', () => {
  const app = createApp();
  const Plan = mongoose.model('Plan');
  const Subscription = mongoose.model('Subscription');

  beforeEach(async () => {
    process.env.STRIPE_MOCK = 'true';
    await Plan.findOneAndUpdate(
      { tier: 'starter' },
      { $set: { name: 'Starter', stripePriceId: 'price_test_starter', active: true } },
      { upsert: true }
    );
  });

  it('checkout requires auth', async () => {
    await request(app).post('/api/v1/billing/checkout').send({ tier: 'starter' }).expect(401);
  });

  it('checkout returns mock checkout url for authenticated user', async () => {
    const { agent } = await registerAgent(app, 'billing-checkout@example.com');

    const res = await agent.post('/api/v1/billing/checkout').send({ tier: 'starter' }).expect(200);

    expect(res.body.checkoutUrl).toMatch(/checkout=success|billing/);
    expect(res.body.sessionId).toMatch(/^cs_test_mock_/);
  });

  it('webhook upserts subscription on checkout.session.completed', async () => {
    const User = mongoose.model('User');
    const Org = mongoose.model('Org');
    const user = await User.create({ email: 'billing-webhook@example.com' });
    const org = await Org.create({ name: 'Webhook Org', ownerUserId: user._id });
    await User.findByIdAndUpdate(user._id, { $set: { primaryOrgId: org._id } });

    const payload = {
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: user._id.toString(),
          customer: 'cus_webhook_1',
          subscription: 'sub_webhook_1',
        },
      },
    };

    await request(app)
      .post('/api/v1/billing/webhook')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload))
      .expect(200);

    const sub = await Subscription.findOne({ userId: user._id })
      .select('+stripeCustomerId status orgId')
      .lean();
    expect(sub?.status).toBe('active');
    expect(sub?.stripeCustomerId).toBe('cus_webhook_1');
    expect(sub?.orgId?.toString()).toBe(org._id.toString());
  });

  it('webhook rejects invalid signature when not in mock mode', async () => {
    const prev = process.env.STRIPE_MOCK;
    delete process.env.STRIPE_MOCK;
    process.env.NODE_ENV = 'test';

    const res = await request(app)
      .post('/api/v1/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('stripe-signature', 'bad')
      .send(JSON.stringify({ type: 'ping' }))
      .expect(400);

    expect(res.body.error).toMatch(/STRIPE_WEBHOOK/);

    process.env.STRIPE_MOCK = prev ?? 'true';
  });

  it('status returns subscription for authenticated user', async () => {
    const { agent, userId } = await registerAgent(app, 'billing-status@example.com');
    const plan = await Plan.findOne({ tier: 'starter' });
    await Subscription.create({
      userId: new mongoose.Types.ObjectId(userId),
      planId: plan._id,
      status: 'active',
      currentPeriodEnd: new Date(Date.now() + 86400000),
    });

    const res = await agent.get('/api/v1/billing/status').expect(200);
    expect(res.body.subscription.status).toBe('active');
    expect(res.body.subscription.plan.tier).toBe('starter');
  });

  it('status returns org subscription for invited member with primaryOrgId', async () => {
    const User = mongoose.model('User');
    const Org = mongoose.model('Org');
    const Membership = mongoose.model('Membership');
    const plan = await Plan.findOne({ tier: 'starter' });

    const { userId: ownerId } = await registerAgent(app, 'billing-status-owner@example.com');
    const { agent: memberAgent } = await registerAgent(app, 'billing-status-member@example.com');
    const org = await Org.create({
      name: 'Billing Status Org',
      ownerUserId: new mongoose.Types.ObjectId(ownerId),
    });
    const memberUserId = new mongoose.Types.ObjectId(
      (await User.findOne({ email: 'billing-status-member@example.com' }).select('_id').lean())._id
    );
    await Membership.create({ orgId: org._id, userId: memberUserId, role: 'member' });
    await User.findByIdAndUpdate(memberUserId, { $set: { primaryOrgId: org._id } });
    await Subscription.create({
      userId: new mongoose.Types.ObjectId(ownerId),
      orgId: org._id,
      planId: plan._id,
      status: 'active',
      stripeCustomerId: 'cus_org_member',
      currentPeriodEnd: new Date(Date.now() + 86400000),
    });

    const res = await memberAgent.get('/api/v1/billing/status').expect(200);
    expect(res.body.subscription.status).toBe('active');
    expect(res.body.subscription.plan.tier).toBe('starter');
  });

  it('portal returns org billing portal for invited member with primaryOrgId', async () => {
    const User = mongoose.model('User');
    const Org = mongoose.model('Org');
    const Membership = mongoose.model('Membership');
    const plan = await Plan.findOne({ tier: 'starter' });

    const { userId: ownerId } = await registerAgent(app, 'billing-portal-owner@example.com');
    const { agent: memberAgent } = await registerAgent(app, 'billing-portal-member@example.com');
    const org = await Org.create({
      name: 'Billing Portal Org',
      ownerUserId: new mongoose.Types.ObjectId(ownerId),
    });
    const memberUserId = new mongoose.Types.ObjectId(
      (await User.findOne({ email: 'billing-portal-member@example.com' }).select('_id').lean())._id
    );
    await Membership.create({ orgId: org._id, userId: memberUserId, role: 'member' });
    await User.findByIdAndUpdate(memberUserId, { $set: { primaryOrgId: org._id } });
    await Subscription.create({
      userId: new mongoose.Types.ObjectId(ownerId),
      orgId: org._id,
      planId: plan._id,
      status: 'active',
      stripeCustomerId: 'cus_org_portal',
      currentPeriodEnd: new Date(Date.now() + 86400000),
    });

    const res = await memberAgent.post('/api/v1/billing/portal').expect(200);
    expect(res.body.portalUrl).toMatch(/billing|portal/);
  });
});
