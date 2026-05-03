'use strict';

jest.mock('../lib/temporalClient', () => ({
  getTemporalClient: jest.fn(),
}));

const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../app');
const { createDevUser, authHeader } = require('./helpers');
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
    const user = await createDevUser('primary@test.com');
    const h = authHeader(user);

    const first = await request(app).post('/api/v1/onboarding/business').set(h).expect(201);
    await mongoose.model('User').findByIdAndUpdate(user._id, {
      primaryBusinessId: first.body.businessId,
    });

    const second = await request(app).post('/api/v1/onboarding/business').set(h).expect(201);

    expect(second.body.businessId).not.toBe(first.body.businessId);

    const refreshed = await mongoose.model('User').findById(user._id).lean();
    expect(refreshed.primaryBusinessId.toString()).toBe(first.body.businessId);
  });

  it('rejects scrape with invalid businessId', async () => {
    const user = await createDevUser();
    const res = await request(app)
      .post('/api/v1/onboarding/business/not-an-id/scrape')
      .set(authHeader(user))
      .send({ websiteUrl: 'https://example.com' })
      .expect(400);

    expect(res.body.error).toBe('validation_error');
  });

  it('rejects scrape with bad URL', async () => {
    const user = await createDevUser();
    const draft = await request(app).post('/api/v1/onboarding/business').set(authHeader(user)).expect(201);

    const res = await request(app)
      .post(`/api/v1/onboarding/business/${draft.body.businessId}/scrape`)
      .set(authHeader(user))
      .send({ websiteUrl: 'ftp://bad' })
      .expect(400);

    expect(res.body.error).toBe('validation_error');
  });

  it('404 when scraping another users draft', async () => {
    const u1 = await createDevUser('a@test.com');
    const u2 = await createDevUser('b@test.com');
    const draft = await request(app).post('/api/v1/onboarding/business').set(authHeader(u1)).expect(201);

    await request(app)
      .post(`/api/v1/onboarding/business/${draft.body.businessId}/scrape`)
      .set(authHeader(u2))
      .send({ websiteUrl: 'https://example.com' })
      .expect(404);
  });

  it('starts async scrape (202) and creates ScrapeRun', async () => {
    const user = await createDevUser('async@test.com');
    const h = authHeader(user);
    const draft = await request(app).post('/api/v1/onboarding/business').set(h).expect(201);
    const bid = draft.body.businessId;

    const res = await request(app)
      .post(`/api/v1/onboarding/business/${bid}/scrape`)
      .set(h)
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
    const user = await createDevUser('503@test.com');
    const h = authHeader(user);
    const draft = await request(app).post('/api/v1/onboarding/business').set(h).expect(201);
    const bid = draft.body.businessId;

    const res = await request(app)
      .post(`/api/v1/onboarding/business/${bid}/scrape`)
      .set(h)
      .send({ websiteUrl: 'https://fail.example.com' })
      .expect(503);

    expect(res.body.error).toBe('temporal_unavailable');
    expect(res.body.scrapeRunId).toBeDefined();

    const run = await mongoose.model('ScrapeRun').findById(res.body.scrapeRunId).lean();
    expect(run.status).toBe('FAILED');
  });

  it('GET scrape run returns RUNNING without suggested', async () => {
    const user = await createDevUser('poll@test.com');
    const h = authHeader(user);
    const draft = await request(app).post('/api/v1/onboarding/business').set(h).expect(201);
    const bid = draft.body.businessId;

    const start = await request(app)
      .post(`/api/v1/onboarding/business/${bid}/scrape`)
      .set(h)
      .send({ websiteUrl: 'https://poll.example.com' })
      .expect(202);

    const poll = await request(app)
      .get(`/api/v1/onboarding/business/${bid}/scrape-runs/${start.body.scrapeRunId}`)
      .set(h)
      .expect(200);

    expect(poll.body.scrapeRun.status).toBe('RUNNING');
    expect(poll.body.scrapeRun.suggested).toBeNull();
  });

  it('creates distinct ScrapeRuns for repeated scrapes', async () => {
    const user = await createDevUser('two@test.com');
    const h = authHeader(user);
    const draft = await request(app).post('/api/v1/onboarding/business').set(h).expect(201);
    const bid = draft.body.businessId;

    const a = await request(app)
      .post(`/api/v1/onboarding/business/${bid}/scrape`)
      .set(h)
      .send({ websiteUrl: 'https://one.example.com' })
      .expect(202);
    const b = await request(app)
      .post(`/api/v1/onboarding/business/${bid}/scrape`)
      .set(h)
      .send({ websiteUrl: 'https://two.example.com' })
      .expect(202);

    expect(a.body.scrapeRunId).not.toBe(b.body.scrapeRunId);

    const count = await mongoose.model('ScrapeRun').countDocuments({
      businessId: new mongoose.Types.ObjectId(bid),
    });
    expect(count).toBe(2);
  });
});
