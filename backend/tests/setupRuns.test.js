'use strict';

jest.mock('../lib/temporalClient', () => ({
  getTemporalClient: jest.fn(),
}));

const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../app');
const { registerAgent } = require('./helpers');
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
    const { agent } = await registerAgent(app, email);
    const draft = await agent.post('/api/v1/onboarding/business').expect(201);
    const bid = draft.body.businessId;
    await agent
      .post(`/api/v1/onboarding/business/${bid}/scrape`)
      .send({ websiteUrl: 'https://example.com' })
      .expect(202);
    await agent.put(`/api/v1/business-contexts/${bid}`).send({ businessName: 'Co' }).expect(200);
    return { agent, bid };
  }

  it('returns 400 for invalid setupRunId', async () => {
    const { agent } = await registerAgent(app, 'sr_bad_id@test.com');
    await agent.get('/api/v1/setup-runs/not-an-id').expect(400);
  });

  it('returns 400 when businessId is invalid', async () => {
    const { agent } = await registerAgent(app, 'sr_bad_biz@test.com');
    const res = await agent.post('/api/v1/setup-runs').send({ businessId: 'not-valid' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('409 when business context is not confirmed', async () => {
    const { agent } = await registerAgent(app, 'sr_unconfirmed@test.com');
    const draft = await agent.post('/api/v1/onboarding/business').expect(201);
    const bid = draft.body.businessId;
    await agent
      .post(`/api/v1/onboarding/business/${bid}/scrape`)
      .send({ websiteUrl: 'https://example.com' })
      .expect(202);

    const res = await agent.post('/api/v1/setup-runs').send({ businessId: bid }).expect(409);

    expect(res.body.error).toBe('precondition_failed');
  });

  it('201 starts workflow when Temporal is reachable', async () => {
    const workflowStart = jest.fn().mockResolvedValue(undefined);
    getTemporalClient.mockResolvedValue({
      workflow: { start: workflowStart },
    });

    const { agent, bid } = await confirmedBusiness('sr-ok@test.com');

    const res = await agent.post('/api/v1/setup-runs').send({ businessId: bid }).expect(201);

    expect(res.body.setupRunId).toMatch(/^[a-f0-9]{24}$/);
    expect(res.body.status).toBe('RUNNING');
    expect(workflowStart.mock.calls[0][0]).toBe('scrapeWorkflow');
    expect(workflowStart.mock.calls[1][0]).toBe('setupRunWorkflow');
    expect(workflowStart.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        args: [{ setupRunId: res.body.setupRunId, message: 'setup-started' }],
      })
    );
  });

  it('503 preserves setupRunId when Temporal workflow start fails', async () => {
    const workflowStart = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('broker down'));
    getTemporalClient.mockResolvedValue({
      workflow: { start: workflowStart },
    });

    const { agent, bid } = await confirmedBusiness('sr-fail@test.com');

    const res = await agent.post('/api/v1/setup-runs').send({ businessId: bid }).expect(503);

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

    const { agent, bid } = await confirmedBusiness('sr-own@test.com');
    const created = await agent.post('/api/v1/setup-runs').send({ businessId: bid }).expect(201);
    const sid = created.body.setupRunId;

    const { agent: otherAgent } = await registerAgent(app, 'sr-other@test.com');
    await otherAgent.get(`/api/v1/setup-runs/${sid}`).expect(404);
  });

  it('GET returns steps sorted by stepName', async () => {
    const workflowStart = jest.fn().mockResolvedValue(undefined);
    getTemporalClient.mockResolvedValue({
      workflow: { start: workflowStart },
    });

    const { agent, bid } = await confirmedBusiness('sr-steps@test.com');
    const created = await agent.post('/api/v1/setup-runs').send({ businessId: bid }).expect(201);
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

    const detail = await agent.get(`/api/v1/setup-runs/${sid}`).expect(200);
    expect(detail.body.steps.map((s) => s.stepName)).toEqual(['alpha', 'zebra']);
  });

  it('GET returns 401 when unauthenticated', async () => {
    await request(app).get(`/api/v1/setup-runs/${new mongoose.Types.ObjectId().toString()}`).expect(401);
  });
});
