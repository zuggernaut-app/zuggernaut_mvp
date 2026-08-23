'use strict';

const request = require('supertest');
const { createApp } = require('../app');
const { REQUEST_ID_HEADER } = require('../api/v1/middleware/requestId');

describe('requestId middleware', () => {
  const app = createApp();

  it('returns a generated x-request-id header when none is provided', async () => {
    const res = await request(app).get('/api/v1/health').expect(200);
    expect(typeof res.headers[REQUEST_ID_HEADER]).toBe('string');
    expect(res.headers[REQUEST_ID_HEADER].length).toBeGreaterThan(0);
  });

  it('echoes a valid incoming x-request-id header', async () => {
    const incoming = 'client-trace-abc-123';
    const res = await request(app)
      .get('/api/v1/health')
      .set(REQUEST_ID_HEADER, incoming)
      .expect(200);

    expect(res.headers[REQUEST_ID_HEADER]).toBe(incoming);
  });
});
