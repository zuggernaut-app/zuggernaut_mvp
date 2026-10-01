'use strict';

const request = require('supertest');
const mongoose = require('mongoose');
const { CSRF_COOKIE_NAME, AUTH_ACCESS_COOKIE_NAME } = require('../lib/auth/constants');

const TEST_PASSWORD_DEFAULT = 'SecurePass12';
const TEST_PHONE_DEFAULT = '+1 555 123 4567';

const MUTATING_AGENT_METHODS = ['post', 'put', 'patch', 'delete'];

function extractCookieFromSetCookie(headers, name) {
  const setCookie = headers?.['set-cookie'];
  if (!Array.isArray(setCookie)) return null;
  const line = setCookie.find((c) => c.startsWith(`${name}=`));
  if (!line) return null;
  const match = line.match(new RegExp(`^${name}=([^;]+)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function extractCsrfFromSetCookie(headers) {
  return extractCookieFromSetCookie(headers, CSRF_COOKIE_NAME);
}

function getCsrfTokenFromAgent(agent) {
  if (typeof agent._csrfToken === 'string' && agent._csrfToken.length > 0) {
    return agent._csrfToken;
  }
  const jar = agent.jar;
  if (!jar || typeof jar.getCookies !== 'function') return null;
  return null;
}

/** Attach `X-CSRF-Token` on mutating supertest agent calls when the CSRF cookie is present. */
function attachCsrfToAgent(agent) {
  agent._csrfToken = null;
  for (const method of MUTATING_AGENT_METHODS) {
    const original = agent[method].bind(agent);
    agent[method] = (...args) => {
      const req = original(...args);
      const token = getCsrfTokenFromAgent(agent);
      if (token) {
        req.set('X-CSRF-Token', token);
      }
      req.on('response', (res) => {
        const issued = extractCsrfFromSetCookie(res.headers);
        if (issued) {
          agent._csrfToken = issued;
        }
      });
      return req;
    };
  }
  return agent;
}

/** Register via `/auth/register`; session cookie is retained on returned `agent`. */
async function registerAgent(app, email, options = {}) {
  const agent = attachCsrfToAgent(request.agent(app));
  const password = options.password ?? TEST_PASSWORD_DEFAULT;
  const name = options.name ?? 'Test';
  const res = await agent
    .post('/api/v1/auth/register')
    .send({
      email,
      password,
      phone: options.phone ?? TEST_PHONE_DEFAULT,
      ...(name !== undefined ? { name } : {}),
      ...(options.websiteUrl !== undefined ? { websiteUrl: options.websiteUrl } : {}),
    })
    .expect(201);

  agent._accessCookie = extractCookieFromSetCookie(res.headers, AUTH_ACCESS_COOKIE_NAME);

  return {
    agent,
    userId: res.body.user.id,
    email: res.body.user.email,
    primaryBusinessId: res.body.user.primaryBusinessId ?? null,
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
  TEST_PHONE_DEFAULT,
  registerAgent,
  createBareUser,
  attachCsrfToAgent,
  getCsrfTokenFromAgent,
};
