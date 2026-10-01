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

  it('reuses existing business on second POST and keeps primaryBusinessId', async () => {
    const { agent, userId } = await registerAgent(app, 'primary@test.com');

    const first = await agent.post('/api/v1/onboarding/business').expect(201);
    await mongoose.model('User').findByIdAndUpdate(userId, {
      primaryBusinessId: first.body.businessId,
    });

    const second = await agent.post('/api/v1/onboarding/business').expect(200);

    expect(second.body.businessId).toBe(first.body.businessId);

    const refreshed = await mongoose.model('User').findById(userId).lean();
    expect(refreshed.primaryBusinessId.toString()).toBe(first.body.businessId);
  });

  it('returns 403 for customer onboarding scrape', async () => {
    const { agent } = await registerAgent(app, 'cust_scrape@test.com');
    const draft = await agent.post('/api/v1/onboarding/business').expect(201);

    const res = await agent
      .post(`/api/v1/onboarding/business/${draft.body.businessId}/scrape`)
      .send({ websiteUrl: 'https://example.com' })
      .expect(403);

    expect(res.body.error).toBe('forbidden');
    expect(workflowStart).not.toHaveBeenCalled();
  });

  it('GET scrape run returns RUNNING without suggested', async () => {
    const ScrapeRun = mongoose.model('ScrapeRun');
    const { agent, userId } = await registerAgent(app, 'poll@test.com');
    const draft = await agent.post('/api/v1/onboarding/business').expect(201);
    const bid = draft.body.businessId;

    const scrapeRun = await ScrapeRun.create({
      businessId: new mongoose.Types.ObjectId(bid),
      userId: new mongoose.Types.ObjectId(userId),
      websiteUrl: 'https://poll.example.com',
      status: 'RUNNING',
    });

    const poll = await agent
      .get(`/api/v1/onboarding/business/${bid}/scrape-runs/${scrapeRun._id.toString()}`)
      .expect(200);

    expect(poll.body.scrapeRun.status).toBe('RUNNING');
    expect(poll.body.scrapeRun.suggested).toBeNull();
  });

  it('GET scrape suggestions returns latest onboarding suggested payload', async () => {
    const ScrapeRun = mongoose.model('ScrapeRun');
    const { agent, userId } = await registerAgent(app, 'hints@test.com');
    const draft = await agent.post('/api/v1/onboarding/business').expect(201);
    const bid = draft.body.businessId;

    const suggested = {
      businessName: 'Hints Co',
      services: ['Plumbing'],
      contactMethods: { phones: ['+15551234567'] },
    };

    await ScrapeRun.create({
      businessId: new mongoose.Types.ObjectId(bid),
      userId: new mongoose.Types.ObjectId(userId),
      websiteUrl: 'https://hints.example.com',
      purpose: 'onboarding',
      status: 'SUCCEEDED',
      resultSuggested: suggested,
    });

    const res = await agent
      .get(`/api/v1/onboarding/business/${bid}/scrape-suggestions`)
      .expect(200);

    expect(res.body.suggested).toMatchObject(suggested);
    expect(res.body.status).toBe('SUCCEEDED');
  });

  it('GET scrape run returns terminal suggested payload', async () => {
    const ScrapeRun = mongoose.model('ScrapeRun');
    const { agent, userId } = await registerAgent(app, 'terminal@test.com');
    const draft = await agent.post('/api/v1/onboarding/business').expect(201);
    const bid = draft.body.businessId;

    const suggested = {
      businessName: 'Terminal Co',
      scrapeQuality: 'weak',
      manualFallback: false,
      services: ['A'],
    };

    const scrapeRun = await ScrapeRun.create({
      businessId: new mongoose.Types.ObjectId(bid),
      userId: new mongoose.Types.ObjectId(userId),
      websiteUrl: 'https://terminal.example.com',
      status: 'PARTIAL',
      resultSuggested: suggested,
    });

    const poll = await agent
      .get(`/api/v1/onboarding/business/${bid}/scrape-runs/${scrapeRun._id.toString()}`)
      .expect(200);

    expect(poll.body.scrapeRun.status).toBe('PARTIAL');
    expect(poll.body.scrapeRun.suggested).toMatchObject(suggested);
    expect(poll.body.scrapeRun.scrapeQuality).toBe('weak');
    expect(poll.body.scrapeRun.manualFallback).toBe(false);
  });

  it('404 when polling another users scrape run', async () => {
    const ScrapeRun = mongoose.model('ScrapeRun');
    const { agent: agent1, userId } = await registerAgent(app, 'poll_a@test.com');
    const { agent: agent2 } = await registerAgent(app, 'poll_b@test.com');

    const draft = await agent1.post('/api/v1/onboarding/business').expect(201);
    const bid = draft.body.businessId;

    const scrapeRun = await ScrapeRun.create({
      businessId: new mongoose.Types.ObjectId(bid),
      userId: new mongoose.Types.ObjectId(userId),
      websiteUrl: 'https://poll.example.com',
      status: 'RUNNING',
    });

    await agent2
      .get(`/api/v1/onboarding/business/${bid}/scrape-runs/${scrapeRun._id.toString()}`)
      .expect(404);
  });

  describe('SOFT_LAUNCH_MODE single business', () => {
    const originalFlag = process.env.SOFT_LAUNCH_MODE;

    afterEach(() => {
      if (originalFlag === undefined) {
        delete process.env.SOFT_LAUNCH_MODE;
      } else {
        process.env.SOFT_LAUNCH_MODE = originalFlag;
      }
    });

    it('returns existing business on second POST when soft launch is enabled', async () => {
      process.env.SOFT_LAUNCH_MODE = 'true';
      const { agent } = await registerAgent(app, 'sl-second@test.com');
      const first = await agent.post('/api/v1/onboarding/business').expect(201);
      const second = await agent.post('/api/v1/onboarding/business').expect(200);
      expect(second.body.businessId).toBe(first.body.businessId);
    });

    it('releases softLaunchClaim when BusinessContext.create fails', async () => {
      process.env.SOFT_LAUNCH_MODE = 'true';
      const BusinessContext = mongoose.model('BusinessContext');
      const createSpy = jest
        .spyOn(BusinessContext, 'create')
        .mockRejectedValueOnce(new Error('create failed'));

      const { agent, userId } = await registerAgent(app, 'sl-unlock@test.com');
      try {
        await agent.post('/api/v1/onboarding/business').expect(500);
      } finally {
        createSpy.mockRestore();
      }

      const user = await mongoose.model('User').findById(userId).select('softLaunchClaim').lean();
      expect(user.softLaunchClaim).toBeUndefined();

      await agent.post('/api/v1/onboarding/business').expect(201);
    });
  });
});
