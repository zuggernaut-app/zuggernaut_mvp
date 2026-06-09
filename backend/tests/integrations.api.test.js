'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../app');
const { registerAgent } = require('./helpers');
const {
  signOAuthState,
  completeGoogleOAuthCallback,
} = require('../services/integrations/googleOAuthService');

describe('integrations API', () => {
  const app = createApp();

  async function confirmedBusiness(email) {
    const { agent } = await registerAgent(app, email);
    const draft = await agent.post('/api/v1/onboarding/business').expect(201);
    const bid = draft.body.businessId;
    await agent.put(`/api/v1/business-contexts/${bid}`).send({ businessName: 'Co' }).expect(200);
    return { agent, bid };
  }

  it('returns 401 for status without auth', async () => {
    await request(app)
      .get('/api/v1/integrations/status')
      .query({ businessId: new mongoose.Types.ObjectId().toString() })
      .expect(401);
  });

  it('returns connection statuses without tokens', async () => {
    const { agent, bid } = await confirmedBusiness('int-status@test.com');

    const res = await agent.get('/api/v1/integrations/status').query({ businessId: bid }).expect(200);

    expect(res.body.businessId).toBe(bid);
    expect(res.body.connections.gtm.ready).toBe(false);
    expect(res.body.connections.google_ads.ready).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/accessToken|refreshToken|mock-access/i);
  });

  it('returns connect URL for owned business', async () => {
    const { agent, bid } = await confirmedBusiness('int-url@test.com');

    const res = await agent
      .get('/api/v1/integrations/google/gtm/connect-url')
      .query({ businessId: bid })
      .expect(200);

    expect(res.body.url).toContain('accounts.google.com');
    expect(res.body.provider).toBe('gtm');
  });

  it('OAuth callback redirects to frontend on success', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const user = await User.create({ email: 'int-cb@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });

    const state = signOAuthState({
      businessId: bc.businessId.toString(),
      provider: 'google_ads',
      userId: user._id.toString(),
    });

    const res = await request(app)
      .get('/api/v1/integrations/google/callback')
      .query({ code: 'mock-code', state })
      .expect(302);

    expect(res.headers.location).toContain('integration=connected');
    expect(res.headers.location).toContain('provider=google_ads');
  });

  it('OAuth callback rejects invalid state', async () => {
    const res = await request(app)
      .get('/api/v1/integrations/google/callback')
      .query({ code: 'x', state: 'bad-state' })
      .expect(302);

    expect(res.headers.location).toContain('integration=error');
    expect(res.headers.location).toContain('invalid_state');
  });

  it('status API hides tokens from owner and denies other users', async () => {
    const User = mongoose.model('User');
    const { agent, bid } = await confirmedBusiness('int-owner-flow@test.com');
    const owner = await User.findOne({ email: 'int-owner-flow@test.com' }).lean();

    await completeGoogleOAuthCallback({
      businessId: bid,
      provider: 'gtm',
      userId: owner._id.toString(),
      code: 'mock',
    });

    const res = await agent.get('/api/v1/integrations/status').query({ businessId: bid }).expect(200);
    expect(res.body.connections.gtm.ready).toBe(false);
    expect(res.body.connections.gtm.reason).toBe('selection_required');
    expect(JSON.stringify(res.body)).not.toMatch(/accessToken|refreshToken|mock-access/i);

    const { agent: otherAgent } = await registerAgent(app, 'int-other@test.com');
    await otherAgent.get('/api/v1/integrations/status').query({ businessId: bid }).expect(404);
  });
});
