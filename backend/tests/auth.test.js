'use strict';

const request = require('supertest');
const { createApp } = require('../app');
const { PASSWORD_MIN_LENGTH } = require('../lib/auth/passwordPolicy');
const { TEST_PASSWORD_DEFAULT, registerAgent } = require('./helpers');

describe('/api/v1/auth', () => {
  const app = createApp();

  it('register rejects short password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'short_pw@example.com',
        password: 'a'.repeat(PASSWORD_MIN_LENGTH - 1),
        name: 'X',
      })
      .expect(400);

    expect(res.body.error).toBe('validation_error');
  });

  it('register returns cookie and `/me` echoes user', async () => {
    const { agent } = await registerAgent(app, 'cookie_me@example.com');

    const me = await agent.get('/api/v1/auth/me').expect(200);
    expect(me.body.user.id).toMatch(/^[a-f0-9]{24}$/);
    expect(me.body.user.email).toBe('cookie_me@example.com');
  });

  it('duplicate register returns conflict', async () => {
    const email = 'dup_auth@example.com';
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: TEST_PASSWORD_DEFAULT, name: 'A' })
      .expect(201);

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: TEST_PASSWORD_DEFAULT, name: 'B' })
      .expect(409);

    expect(res.body.error).toBe('conflict');
  });

  it('login rejects bad password without leaking details', async () => {
    const email = 'login_bad_pw@example.com';
    await request(app)
      .post('/api/v1/auth/register')
      .send({ email, password: TEST_PASSWORD_DEFAULT, name: 'A' })
      .expect(201);

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'WrongPassword!' })
      .expect(401);

    expect(res.body.message).toBe('Invalid email or password');

    const res2 = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nope-unknown@example.com', password: 'WrongPassword!' })
      .expect(401);

    expect(res2.body.message).toBe('Invalid email or password');
  });

  it('/me without session returns 401', async () => {
    await request(app).get('/api/v1/auth/me').expect(401);
  });

  it('logout clears session', async () => {
    const { agent } = await registerAgent(app, 'logout@example.com');
    await agent.get('/api/v1/auth/me').expect(200);

    await agent.post('/api/v1/auth/logout').expect(200);
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('protected onboarding requires auth cookie', async () => {
    await request(app).post('/api/v1/onboarding/business').expect(401);

    const { agent } = await registerAgent(app, 'onboard_prot@example.com');
    await agent.post('/api/v1/onboarding/business').expect(201);
  });
});
