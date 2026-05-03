'use strict';

const request = require('supertest');
const { createApp } = require('../app');

describe('POST /api/v1/users (legacy)', () => {
  const app = createApp();

  it('is gone — clients must POST /api/v1/auth/register', async () => {
    const res = await request(app)
      .post('/api/v1/users')
      .send({ email: 'gone@example.com', name: 'Ada' })
      .expect(410);

    expect(res.body.error).toBe('gone');
    expect(typeof res.body.message).toBe('string');
  });
});
