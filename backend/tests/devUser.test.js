'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../app');
const { createDevUser, authHeader } = require('./helpers');

describe('devUserRequired middleware', () => {
  const app = createApp();

  it('returns 401 without x-dev-user-id', async () => {
    await request(app).post('/api/v1/onboarding/business').expect(401);
  });

  it('returns 401 for invalid ObjectId header', async () => {
    await request(app)
      .post('/api/v1/onboarding/business')
      .set({ 'x-dev-user-id': 'nope' })
      .expect(401);
  });

  it('returns 401 when user row is missing', async () => {
    const missingId = new mongoose.Types.ObjectId().toString();
    await request(app)
      .post('/api/v1/onboarding/business')
      .set({ 'x-dev-user-id': missingId })
      .expect(401);
  });

  it('passes when user exists', async () => {
    const user = await createDevUser('mw@test.com');
    await request(app).post('/api/v1/onboarding/business').set(authHeader(user)).expect(201);
  });
});

describe('devUserRequired when NODE_ENV is production', () => {
  const app = createApp();
  const prevNodeEnv = process.env.NODE_ENV;
  const prevAllow = process.env.ALLOW_DEV_USER_AUTH;

  afterAll(() => {
    process.env.NODE_ENV = prevNodeEnv;
    if (prevAllow === undefined) delete process.env.ALLOW_DEV_USER_AUTH;
    else process.env.ALLOW_DEV_USER_AUTH = prevAllow;
  });

  it('returns 403 when ALLOW_DEV_USER_AUTH is not true', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ALLOW_DEV_USER_AUTH;

    const user = await createDevUser('prod-block@test.com');
    const res = await request(app)
      .post('/api/v1/onboarding/business')
      .set(authHeader(user));

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('allows requests when ALLOW_DEV_USER_AUTH=true', async () => {
    process.env.NODE_ENV = 'production';
    process.env.ALLOW_DEV_USER_AUTH = 'true';

    const user = await createDevUser('staging-allow@test.com');
    await request(app).post('/api/v1/onboarding/business').set(authHeader(user)).expect(201);
  });
});
