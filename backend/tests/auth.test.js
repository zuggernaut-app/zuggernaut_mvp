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

  it('sets SameSite=Lax on session cookie in development', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSameSite = process.env.COOKIE_SAMESITE;
    process.env.NODE_ENV = 'development';
    delete process.env.COOKIE_SAMESITE;

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'samesite_dev@example.com', password: TEST_PASSWORD_DEFAULT, name: 'A' })
      .expect(201);

    const setCookie = res.headers['set-cookie'];
    expect(Array.isArray(setCookie)).toBe(true);
    const accessCookie = setCookie.find((c) => c.startsWith('zugg_access='));
    expect(accessCookie).toMatch(/SameSite=Lax/i);

    process.env.NODE_ENV = prevNodeEnv;
    if (prevSameSite === undefined) delete process.env.COOKIE_SAMESITE;
    else process.env.COOKIE_SAMESITE = prevSameSite;
  });

  it('sets SameSite=None; Secure on session cookie in split-hosting production', async () => {
    const prevNodeEnv = process.env.NODE_ENV;
    const prevOrigin = process.env.FRONTEND_ORIGIN;
    const prevSameSite = process.env.COOKIE_SAMESITE;
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_ORIGIN = 'https://zuggernaut-mvp.web.app';
    delete process.env.COOKIE_SAMESITE;

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'samesite_prod@example.com', password: TEST_PASSWORD_DEFAULT, name: 'A' })
      .expect(201);

    const setCookie = res.headers['set-cookie'];
    const accessCookie = setCookie.find((c) => c.startsWith('zugg_access='));
    expect(accessCookie).toMatch(/SameSite=None/i);
    expect(accessCookie).toMatch(/;\s*Secure/i);

    process.env.NODE_ENV = prevNodeEnv;
    process.env.FRONTEND_ORIGIN = prevOrigin;
    if (prevSameSite === undefined) delete process.env.COOKIE_SAMESITE;
    else process.env.COOKIE_SAMESITE = prevSameSite;
  });

  it('rejects authenticated mutating requests without CSRF token', async () => {
    const { agent } = await registerAgent(app, 'csrf_block@example.com');
    expect(agent._accessCookie).toBeTruthy();

    await request(app)
      .post('/api/v1/onboarding/business')
      .set('Cookie', `zugg_access=${agent._accessCookie}`)
      .expect(403);
  });

  it('GET /auth/csrf issues CSRF cookie and token', async () => {
    const res = await request(app).get('/api/v1/auth/csrf').expect(200);
    expect(typeof res.body.csrfToken).toBe('string');
    expect(res.body.csrfToken.length).toBeGreaterThan(10);

    const setCookie = res.headers['set-cookie'];
    const csrfCookie = setCookie.find((c) => c.startsWith('zugg_csrf='));
    expect(csrfCookie).toBeDefined();
    expect(csrfCookie).toMatch(/SameSite=Lax/i);
  });
});
