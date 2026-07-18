'use strict';

jest.mock('../lib/temporalClient', () => ({
  getTemporalClient: jest.fn(),
}));

const request = require('supertest');
const mongoose = require('mongoose');
const { createApp } = require('../app');
const { registerAgent } = require('./helpers');
const { getTemporalClient } = require('../lib/temporalClient');
const {
  SETUP_RUN_WORKFLOW_NAME,
  SCRAPE_WORKFLOW_NAME,
  resolveTemporalTaskQueue,
} = require('../constants/temporalDefaults');

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
    await agent
      .put(`/api/v1/business-contexts/${bid}`)
      .send({
        businessName: 'Co',
        websiteUrl: 'https://example.com',
        services: ['Example service'],
        serviceAreas: ['Local area'],
        goals: { primary: 'both' },
      })
      .expect(200);
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

  it('400 when confirmed business context is not ads-ready', async () => {
    const { agent } = await registerAgent(app, 'sr_not_ready@test.com');
    const draft = await agent.post('/api/v1/onboarding/business').expect(201);
    const bid = draft.body.businessId;
    await agent
      .put(`/api/v1/business-contexts/${bid}`)
      .send({ businessName: 'Co' })
      .expect(200);

    const res = await agent.post('/api/v1/setup-runs').send({ businessId: bid }).expect(400);

    expect(res.body.error).toBe('validation_error');
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
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
    expect(workflowStart.mock.calls[0][0]).toBe(SCRAPE_WORKFLOW_NAME);
    expect(workflowStart.mock.calls[1][0]).toBe(SETUP_RUN_WORKFLOW_NAME);
    expect(workflowStart.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        taskQueue: resolveTemporalTaskQueue(),
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

  it('GET /report returns normalized dashboard payload for owner', async () => {
    const workflowStart = jest.fn().mockResolvedValue(undefined);
    getTemporalClient.mockResolvedValue({
      workflow: { start: workflowStart },
    });

    const { agent, bid } = await confirmedBusiness('sr-report@test.com');
    const created = await agent.post('/api/v1/setup-runs').send({ businessId: bid }).expect(201);
    const sid = created.body.setupRunId;

    const SetupRun = mongoose.model('SetupRun');
    const SetupStepExecution = mongoose.model('SetupStepExecution');
    const runOid = new mongoose.Types.ObjectId(sid);
    const bizOid = new mongoose.Types.ObjectId(bid);

    await SetupRun.findByIdAndUpdate(runOid, {
      status: 'SUCCEEDED',
      meta: {
        gbpAudit: 'complete',
        gbpAuditSummary: { presentCount: 1, missingCount: 0, needsAttentionCount: 0 },
        ads: 'campaigns_recorded',
        adsCampaignSummary: {
          campaignCreated: true,
          adGroupCreated: true,
          adCreated: true,
          reusedArtifacts: 0,
          campaignExternalId: 'customers/123/campaigns/mock',
          conversionLinkCount: 1,
        },
      },
    });

    await SetupStepExecution.create({
      setupRunId: runOid,
      businessId: bizOid,
      stepName: 'ads_campaign_creation',
      status: 'success',
      provider: 'google_ads',
      attemptCount: 1,
    });

    const res = await agent.get(`/api/v1/setup-runs/${sid}/report`).expect(200);
    expect(res.body.report.setupRun.id).toBe(sid);
    expect(res.body.report.outcome.kind).toBe('succeeded');
    expect(res.body.report.adsCampaign.status).toBe('campaigns_recorded');
    expect(res.body.report.steps.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /report denies access for other users', async () => {
    const workflowStart = jest.fn().mockResolvedValue(undefined);
    getTemporalClient.mockResolvedValue({
      workflow: { start: workflowStart },
    });

    const { agent, bid } = await confirmedBusiness('sr-report-deny@test.com');
    const created = await agent.post('/api/v1/setup-runs').send({ businessId: bid }).expect(201);
    const sid = created.body.setupRunId;

    const { agent: otherAgent } = await registerAgent(app, 'sr-report-other@test.com');
    await otherAgent.get(`/api/v1/setup-runs/${sid}/report`).expect(404);
  });

  it('GET returns stuckState contract for RUNNING setup runs', async () => {
    const { agent, bid } = await confirmedBusiness('sr-stuck@test.com');
    const SetupRun = mongoose.model('SetupRun');
    const created = await agent.post('/api/v1/setup-runs').send({ businessId: bid }).expect(201);
    const sid = created.body.setupRunId;

    const res = await agent.get(`/api/v1/setup-runs/${sid}`).expect(200);
    expect(res.body.stuckState).toEqual(
      expect.objectContaining({
        stuck: expect.any(Boolean),
        thresholdMs: expect.any(Number),
      })
    );
    expect(res.body.setupRun.id).toBe(sid);
    expect(JSON.stringify(res.body)).not.toMatch(/accessToken|refreshToken/i);
  });

  it('GET /report returns 401 when unauthenticated', async () => {
    await request(app)
      .get(`/api/v1/setup-runs/${new mongoose.Types.ObjectId().toString()}/report`)
      .expect(401);
  });

  it('GET /report returns 400 for invalid setupRunId', async () => {
    const { agent } = await registerAgent(app, 'sr-report-bad@test.com');
    await agent.get('/api/v1/setup-runs/not-an-id/report').expect(400);
  });

  it('GET /report response includes required report sections', async () => {
    const { agent, bid } = await confirmedBusiness('sr-report-shape@test.com');
    const created = await agent.post('/api/v1/setup-runs').send({ businessId: bid }).expect(201);
    const sid = created.body.setupRunId;

    const SetupRun = mongoose.model('SetupRun');
    await SetupRun.findByIdAndUpdate(sid, {
      status: 'GTM_SNIPPET_PENDING',
      meta: {
        structuralVerification: { missing: ['snippet'], snippetPresent: false },
      },
    });

    const res = await agent.get(`/api/v1/setup-runs/${sid}/report`).expect(200);
    const report = res.body.report;
    expect(report).toEqual(
      expect.objectContaining({
        setupRun: expect.any(Object),
        outcome: expect.any(Object),
        stuckState: expect.any(Object),
        gbpAudit: expect.any(Object),
        conversionActions: expect.any(Object),
        adsCatalog: expect.any(Object),
        gtmSetup: expect.any(Object),
        structuralVerification: expect.any(Object),
        adsCampaign: expect.any(Object),
        recommendations: expect.any(Array),
        steps: expect.any(Array),
      })
    );
    expect(report.outcome.kind).toBe('snippet_pending');
  });
});
