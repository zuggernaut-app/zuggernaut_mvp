'use strict';

const request = require('supertest');
const { createApp } = require('../app');
const {
  SETUP_RUN_WORKFLOW_NAME,
  resolveTemporalTaskQueue,
} = require('../constants/temporalDefaults');

describe('GET /api/v1/health', () => {
  const app = createApp();

  it('returns ok with orchestration reachability metadata', async () => {
    const res = await request(app).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({
      ok: true,
      service: 'zuggernaut-api',
      version: 'v1',
      orchestration: {
        taskQueue: resolveTemporalTaskQueue(),
        setupWorkflow: SETUP_RUN_WORKFLOW_NAME,
        temporalE2eMock: false,
      },
    });
  });
});
