'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../app');
const {
  generateResetToken,
  hashResetToken,
} = require('../lib/auth/passwordReset');
const { hashPassword } = require('../lib/auth/passwordHash');
const { TEST_PASSWORD_DEFAULT } = require('./helpers');

describe('password reset', () => {
  const app = createApp();
  const User = mongoose.model('User');

  async function createUserWithPassword(email, password = TEST_PASSWORD_DEFAULT) {
    const passwordHash = await hashPassword(password);
    return User.create({ email, passwordHash });
  }

  it('request returns generic ok without leaking unknown email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/password-reset/request')
      .send({ email: 'missing-reset@example.com' })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.message).toMatch(/reset link has been sent/i);
  });

  it('request stores hashed token for existing password user', async () => {
    const email = 'reset-request@example.com';
    await createUserWithPassword(email);

    await request(app)
      .post('/api/v1/auth/password-reset/request')
      .send({ email })
      .expect(200);

    const user = await User.findOne({ email })
      .select('+passwordResetToken +passwordResetExpiresAt')
      .exec();

    expect(typeof user.passwordResetToken).toBe('string');
    expect(user.passwordResetToken.length).toBeGreaterThan(10);
    expect(user.passwordResetExpiresAt).toBeInstanceOf(Date);
    expect(user.passwordResetExpiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('request endpoint rate-limits repeated attempts', async () => {
    const isolatedApp = createApp();
    const email = 'rate-limit-reset@example.com';
    const clientIp = '203.0.113.77';
    await createUserWithPassword(email);

    for (let i = 0; i < 10; i += 1) {
      await request(isolatedApp)
        .post('/api/v1/auth/password-reset/request')
        .set('X-Forwarded-For', clientIp)
        .send({ email })
        .expect(200);
    }

    const blocked = await request(isolatedApp)
      .post('/api/v1/auth/password-reset/request')
      .set('X-Forwarded-For', clientIp)
      .send({ email })
      .expect(429);

    expect(blocked.body.error).toBe('rate_limit_exceeded');
  });

  it('confirm rejects invalid token', async () => {
    const email = 'invalid-token@example.com';
    const plainToken = generateResetToken();
    await createUserWithPassword(email);
    await User.updateOne(
      { email },
      {
        passwordResetToken: hashResetToken(plainToken),
        passwordResetExpiresAt: new Date(Date.now() + 60_000),
      }
    );

    const res = await request(app)
      .post('/api/v1/auth/password-reset/confirm')
      .send({
        email,
        token: 'wrong-token-value',
        password: 'NewSecurePass99',
      })
      .expect(400);

    expect(res.body.message).toMatch(/invalid or expired/i);
  });

  it('confirm rejects expired token', async () => {
    const email = 'expired-token@example.com';
    const plainToken = generateResetToken();
    await createUserWithPassword(email);
    await User.updateOne(
      { email },
      {
        passwordResetToken: hashResetToken(plainToken),
        passwordResetExpiresAt: new Date(Date.now() - 60_000),
      }
    );

    const res = await request(app)
      .post('/api/v1/auth/password-reset/confirm')
      .send({
        email,
        token: plainToken,
        password: 'NewSecurePass99',
      })
      .expect(400);

    expect(res.body.message).toMatch(/invalid or expired/i);
  });

  it('confirm updates password and clears reset fields', async () => {
    const email = 'reset-success@example.com';
    const plainToken = generateResetToken();
    const newPassword = 'NewSecurePass99';
    await createUserWithPassword(email);
    await User.updateOne(
      { email },
      {
        passwordResetToken: hashResetToken(plainToken),
        passwordResetExpiresAt: new Date(Date.now() + 60_000),
      }
    );

    const confirm = await request(app)
      .post('/api/v1/auth/password-reset/confirm')
      .send({
        email,
        token: plainToken,
        password: newPassword,
      })
      .expect(200);

    expect(confirm.body.ok).toBe(true);

    const user = await User.findOne({ email })
      .select('+passwordResetToken +passwordResetExpiresAt')
      .exec();
    expect(user.passwordResetToken).toBeUndefined();
    expect(user.passwordResetExpiresAt).toBeUndefined();

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: newPassword })
      .expect(200);

    await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: TEST_PASSWORD_DEFAULT })
      .expect(401);
  });
});
