'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const crypto = require('crypto');
const { createApp } = require('../app');
const { registerAgent } = require('./helpers');
const { hashResetToken, resetTokenExpiresAt } = require('../lib/auth/passwordReset');

describe('orgs API', () => {
  const app = createApp();
  const Org = mongoose.model('Org');
  const Membership = mongoose.model('Membership');
  const InviteToken = mongoose.model('InviteToken');
  const User = mongoose.model('User');

  it('lists org memberships for authenticated user', async () => {
    const { agent, userId } = await registerAgent(app, 'orgs-list@example.com');
    const org = await Org.create({
      name: 'List Org',
      ownerUserId: new mongoose.Types.ObjectId(userId),
    });
    await Membership.create({
      orgId: org._id,
      userId: new mongoose.Types.ObjectId(userId),
      role: 'owner',
    });

    const res = await agent.get('/api/v1/orgs').expect(200);
    expect(res.body.orgs).toEqual([
      { id: org._id.toString(), name: 'List Org', role: 'owner' },
    ]);
  });

  it('creates org and owner membership', async () => {
    const { agent, userId } = await registerAgent(app, 'orgs-create@example.com');

    const res = await agent.post('/api/v1/orgs').send({ name: 'New Org' }).expect(201);
    expect(res.body.org.name).toBe('New Org');

    const membership = await Membership.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      orgId: new mongoose.Types.ObjectId(res.body.org.id),
    }).lean();
    expect(membership?.role).toBe('owner');

    const user = await User.findById(userId).lean();
    expect(user.primaryOrgId.toString()).toBe(res.body.org.id);
  });

  it('sends invite for org admin', async () => {
    const { agent, userId } = await registerAgent(app, 'orgs-invite-owner@example.com');
    const org = await Org.create({
      name: 'Invite Org',
      ownerUserId: new mongoose.Types.ObjectId(userId),
    });
    await Membership.create({
      orgId: org._id,
      userId: new mongoose.Types.ObjectId(userId),
      role: 'owner',
    });

    const res = await agent
      .post(`/api/v1/orgs/${org._id.toString()}/invites`)
      .send({ email: 'invitee@example.com', role: 'member' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    const invite = await InviteToken.findOne({ email: 'invitee@example.com' }).lean();
    expect(invite?.orgId.toString()).toBe(org._id.toString());
  });

  it('accepts invite and sets primaryOrgId when unset', async () => {
    const owner = await User.create({ email: 'orgs-owner@example.com' });
    const org = await Org.create({ name: 'Accept Org', ownerUserId: owner._id });
    const plainToken = crypto.randomBytes(32).toString('base64url');
    await InviteToken.create({
      orgId: org._id,
      email: 'orgs-invitee@example.com',
      role: 'member',
      tokenHash: hashResetToken(plainToken),
      expiresAt: resetTokenExpiresAt(),
      invitedByUserId: owner._id,
    });

    const { agent, userId } = await registerAgent(app, 'orgs-invitee@example.com');
    const res = await agent
      .post('/api/v1/orgs/accept-invite')
      .send({ token: plainToken, email: 'orgs-invitee@example.com' })
      .expect(200);

    expect(res.body.orgId).toBe(org._id.toString());

    const membership = await Membership.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      orgId: org._id,
    }).lean();
    expect(membership?.role).toBe('member');

    const user = await User.findById(userId).lean();
    expect(user.primaryOrgId.toString()).toBe(org._id.toString());
  });
});
