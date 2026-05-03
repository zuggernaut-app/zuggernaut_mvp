'use strict';

jest.mock('../lib/temporalClient', () => ({
  getTemporalClient: jest.fn(),
}));

const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../app');
const { registerAgent } = require('./helpers');
const { getTemporalClient } = require('../lib/temporalClient');

describe('POST /api/v1/onboarding', () => {
  const app = createApp();
  const workflowStart = jest.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    workflowStart.mockClear();
    getTemporalClient.mockResolvedValue({
      workflow: { start: workflowStart },
    });
  });

  it('sets primaryBusinessId only when missing', async () => {
    const { agent, userId } = await registerAgent(app, 'primary@test.com');

    const first = await agent.post('/api/v1/onboarding/business').expect(201);
    await mongoose.model('User').findByIdAndUpdate(userId, {
      primaryBusinessId: first.body.businessId,
    });

    const second = await agent.post('/api/v1/onboarding/business').expect(201);

    expect(second.body.businessId).not.toBe(first.body.businessId);

    const refreshed = await mongoose.model('User').findById(userId).lean();
    expect(refreshed.primaryBusinessId.toString()).toBe(first.body.businessId);
  });

  it('rejects scrape with invalid businessId', async () => {
    const { agent } = await registerAgent(app, 'inv_bid@test.com');
    const res = await agent
      .post('/api/v1/onboarding/business/not-an-id/scrape')
      .send({ websiteUrl: 'https://example.com' })
      .expect(400);

    expect(res.body.error).toBe('validation_error');
  });

  it('rejects scrape with bad URL', async () => {
    const { agent } = await registerAgent(app, 'bad_url@test.com');
    const draft = await agent.post('/api/v1/onboarding/business').expect(201);

    const res = await agent
      .post(`/api/v1/onboarding/business/${draft.body.businessId}/scrape`)
      .send({ websiteUrl: 'ftp://bad' })
      .expect(400);

    expect(res.body.error).toBe('validation_error');
  });

  it('404 when scraping another users draft', async () => {
    const { agent: agent1 } = await registerAgent(app, 'a@test.com');
    const { agent: agent2 } = await registerAgent(app, 'b@test.com');

    const draft = await agent1.post('/api/v1/onboarding/business').expect(201);

    await agent2
      .post(`/api/v1/onboarding/business/${draft.body.businessId}/scrape`)
      .send({ websiteUrl: 'https://example.com' })
      .expect(404);
  });

  it('starts async scrape (202) and creates ScrapeRun', async () => {
    const { agent } = await registerAgent(app, 'async@test.com');
    const draft = await agent.post('/api/v1/onboarding/business').expect(201);
    const bid = draft.body.businessId;

    const res = await agent
      .post(`/api/v1/onboarding/business/${bid}/scrape`)
      .send({ websiteUrl: 'https://one.example.com' })
      .expect(202);

    expect(res.body.scrapeRunId).toBeDefined();
    expect(res.body.workflowId).toMatch(/^scrape-/);
    expect(res.body.status).toBe('RUNNING');
    expect(workflowStart).toHaveBeenCalledWith(
      'scrapeWorkflow',
      expect.objectContaining({
        workflowId: res.body.workflowId,
        args: [
          expect.objectContaining({
            scrapeRunId: res.body.scrapeRunId,
            businessId: bid,
            websiteUrl: 'https://one.example.com',
          }),
        ],
      })
    );

    const run = await mongoose.model('ScrapeRun').findById(res.body.scrapeRunId).lean();
    expect(run).toBeTruthy();
    expect(run.status).toBe('RUNNING');

    const bc = await mongoose.model('BusinessContext').findOne({
      businessId: new mongoose.Types.ObjectId(bid),
    });
    expect(bc.websiteUrl).toBe('https://one.example.com');
  });

  it('503 when Temporal workflow start fails', async () => {
    workflowStart.mockRejectedValueOnce(new Error('temporal down'));
    const { agent } = await registerAgent(app, '503@test.com');
    const draft = await agent.post('/api/v1/onboarding/business').expect(201);
    const bid = draft.body.businessId;

    const res = await agent
      .post(`/api/v1/onboarding/business/${bid}/scrape`)
      .send({ websiteUrl: 'https://fail.example.com' })
      .expect(503);

    expect(res.body.error).toBe('temporal_unavailable');
    expect(res.body.scrapeRunId).toBeDefined();

    const run = await mongoose.model('ScrapeRun').findById(res.body.scrapeRunId).lean();
    expect(run.status).toBe('FAILED');
  });

  it('GET scrape run returns RUNNING without suggested', async () => {
    const { agent } = await registerAgent(app, 'poll@test.com');
    const draft = await agent.post('/api/v1/onboarding/business').expect(201);
    const bid = draft.body.businessId;

    const start = await agent
      .post(`/api/v1/onboarding/business/${bid}/scrape`)
      .send({ websiteUrl: 'https://poll.example.com' })
      .expect(202);

    const poll = await agent
      .get(`/api/v1/onboarding/business/${bid}/scrape-runs/${start.body.scrapeRunId}`)
      .expect(200);

    expect(poll.body.scrapeRun.status).toBe('RUNNING');
    expect(poll.body.scrapeRun.suggested).toBeNull();
  });

  it('creates distinct ScrapeRuns for repeated scrapes', async () => {
    const { agent } = await registerAgent(app, 'two@test.com');
    const draft = await agent.post('/api/v1/onboarding/business').expect(201);
    const bid = draft.body.businessId;

    const a = await agent
      .post(`/api/v1/onboarding/business/${bid}/scrape`)
      .send({ websiteUrl: 'https://one.example.com' })
      .expect(202);
    const b = await agent
      .post(`/api/v1/onboarding/business/${bid}/scrape`)
      .send({ websiteUrl: 'https://two.example.com' })
      .expect(202);

    expect(a.body.scrapeRunId).not.toBe(b.body.scrapeRunId);

    const count = await mongoose.model('ScrapeRun').countDocuments({
      businessId: new mongoose.Types.ObjectId(bid),
    });
    expect(count).toBe(2);
  });
});
