'use strict';

jest.mock('../lib/temporalClient', () => ({
  getTemporalClient: jest.fn(),
}));

const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../app');
const { createDevUser, authHeader } = require('./helpers');
const { getTemporalClient } = require('../lib/temporalClient');

describe('setup-runs API', () => {
  const app = createApp();

  beforeEach(() => {
    getTemporalClient.mockResolvedValue({
      workflow: {
        start: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  async function confirmedBusiness(email) {
    const user = await createDevUser(email);
    const h = authHeader(user);
    const draft = await request(app).post('/api/v1/onboarding/business').set(h).expect(201);
    const bid = draft.body.businessId;
    await request(app)
      .post(`/api/v1/onboarding/business/${bid}/scrape`)
      .set(h)
      .send({ websiteUrl: 'https://example.com' })
      .expect(200);
    await request(app).put(`/api/v1/business-contexts/${bid}`).set(h).send({ businessName: 'Co' }).expect(200);
    return { user, h, bid };
  }

  it('returns 400 for invalid setupRunId', async () => {
    const user = await createDevUser();
    await request(app).get('/api/v1/setup-runs/not-an-id').set(authHeader(user)).expect(400);
  });

  it('returns 400 when businessId is invalid', async () => {
    const user = await createDevUser();
    const res = await request(app)
      .post('/api/v1/setup-runs')
      .set(authHeader(user))
      .send({ businessId: 'not-valid' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('409 when business context is not confirmed', async () => {
    const user = await createDevUser();
    const h = authHeader(user);
    const draft = await request(app).post('/api/v1/onboarding/business').set(h).expect(201);
    const bid = draft.body.businessId;
    await request(app)
      .post(`/api/v1/onboarding/business/${bid}/scrape`)
      .set(h)
      .send({ websiteUrl: 'https://example.com' })
      .expect(200);

    const res = await request(app).post('/api/v1/setup-runs').set(h).send({ businessId: bid }).expect(409);

    expect(res.body.error).toBe('precondition_failed');
  });

  it('201 starts workflow when Temporal is reachable', async () => {
    const workflowStart = jest.fn().mockResolvedValue(undefined);
    getTemporalClient.mockResolvedValue({
      workflow: { start: workflowStart },
    });

    const { h, bid } = await confirmedBusiness('sr-ok@test.com');

    const res = await request(app).post('/api/v1/setup-runs').set(h).send({ businessId: bid }).expect(201);

    expect(res.body.setupRunId).toMatch(/^[a-f0-9]{24}$/);
    expect(res.body.status).toBe('RUNNING');
    expect(workflowStart).toHaveBeenCalledWith(
      'setupRunWorkflow',
      expect.objectContaining({
        args: [{ setupRunId: res.body.setupRunId, message: 'setup-started' }],
      }),
    );
  });

  it('503 preserves setupRunId when Temporal workflow start fails', async () => {
    const workflowStart = jest.fn().mockRejectedValue(new Error('broker down'));
    getTemporalClient.mockResolvedValue({
      workflow: { start: workflowStart },
    });

    const { h, bid } = await confirmedBusiness('sr-fail@test.com');

    const res = await request(app).post('/api/v1/setup-runs').set(h).send({ businessId: bid }).expect(503);

    expect(res.body.error).toBe('temporal_unavailable');
    expect(res.body.setupRunId).toMatch(/^[a-f0-9]{24}$/);

    const SetupRun = mongoose.model('SetupRun');
    const row = await SetupRun.findById(res.body.setupRunId).lean();
    expect(row.status).toBe('FAILED');
  });

  it('GET denies access for a user who does not own the business', async () => {
    const workflowStart = jest.fn().mockResolvedValue(undefined);
    getTemporalClient.mockResolvedValue({
      workflow: { start: workflowStart },
    });

    const { h, bid } = await confirmedBusiness('sr-own@test.com');
    const created = await request(app).post('/api/v1/setup-runs').set(h).send({ businessId: bid }).expect(201);
    const sid = created.body.setupRunId;

    const other = await createDevUser('sr-other@test.com');
    await request(app).get(`/api/v1/setup-runs/${sid}`).set(authHeader(other)).expect(404);
  });

  it('GET returns steps sorted by stepName', async () => {
    const workflowStart = jest.fn().mockResolvedValue(undefined);
    getTemporalClient.mockResolvedValue({
      workflow: { start: workflowStart },
    });

    const { h, bid } = await confirmedBusiness('sr-steps@test.com');
    const created = await request(app).post('/api/v1/setup-runs').set(h).send({ businessId: bid }).expect(201);
    const sid = created.body.setupRunId;

    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const runOid = new mongoose.Types.ObjectId(sid);
    const bizOid = new mongoose.Types.ObjectId(bid);

    await SetupStepExecution.create({
      setupRunId: runOid,
      stepName: 'zebra',
      businessId: bizOid,
      status: 'pending',
      attemptCount: 0,
    });
    await SetupStepExecution.create({
      setupRunId: runOid,
      stepName: 'alpha',
      businessId: bizOid,
      status: 'pending',
      attemptCount: 0,
    });

    const detail = await request(app).get(`/api/v1/setup-runs/${sid}`).set(h).expect(200);
    expect(detail.body.steps.map((s) => s.stepName)).toEqual(['alpha', 'zebra']);
  });
});
