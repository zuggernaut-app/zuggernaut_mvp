'use strict';

const request = require('supertest');
const { createApp } = require('../app');

describe('GET /api/v1/health', () => {
  const app = createApp();

  it('returns ok', async () => {
    const res = await request(app).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({
      ok: true,
      service: 'zuggernaut-api',
      version: 'v1',
    });
  });
});
