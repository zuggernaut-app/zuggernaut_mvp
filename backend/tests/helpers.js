'use strict';

const request = require('supertest');
const mongoose = require('mongoose');

const TEST_PASSWORD_DEFAULT = 'SecurePass12';

/** Register via `/auth/register`; session cookie is retained on returned `agent`. */
async function registerAgent(app, email, options = {}) {
  const agent = request.agent(app);
  const password = options.password ?? TEST_PASSWORD_DEFAULT;
  const name = options.name ?? 'Test';
  const res = await agent
    .post('/api/v1/auth/register')
    .send({
      email,
      password,
      ...(name !== undefined ? { name } : {}),
    })
    .expect(201);

  return {
    agent,
    userId: res.body.user.id,
    email: res.body.user.email,
  };
}

/**
 * User row without credentials—only for intra-process DB/unit tests that bypass HTTP auth.
 */
async function createBareUser(email = 'bare@test.com') {
  const User = mongoose.model('User');
  return User.create({ email });
}

module.exports = {
  TEST_PASSWORD_DEFAULT,
  registerAgent,
  createBareUser,
};
