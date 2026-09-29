'use strict';

jest.mock('../lib/temporalClient', () => ({
  getTemporalClient: jest.fn(),
}));

const mongoose = require('mongoose');
const { getTemporalClient } = require('../lib/temporalClient');
const { createApp } = require('../app');
const { registerAgent } = require('./helpers');

const User = mongoose.model('User');

describe('PUT /api/v1/business-contexts', () => {
  const app = createApp();

  beforeEach(() => {
    getTemporalClient.mockResolvedValue({
      workflow: { start: jest.fn().mockResolvedValue(undefined) },
    });
  });

  async function draftAndConfirm(email) {
    const { agent } = await registerAgent(app, email);
    const draft = await agent.post('/api/v1/onboarding/business').expect(201);
    const bid = draft.body.businessId;

    const res = await agent.put(`/api/v1/business-contexts/${bid}`).send({
      businessName: 'Acme',
      services: [' one ', 'two'],
      contactMethods: { phone: '1' },
    });

    expect(res.status).toBe(200);
    expect(res.body.businessContext.confirmedAt).toBeTruthy();

    return { agent, bid };
  }

  it('GET returns business context for owner', async () => {
    const { agent, bid } = await draftAndConfirm('get_owner@test.com');

    const res = await agent.get(`/api/v1/business-contexts/${bid}`).expect(200);

    expect(res.body.businessContext.businessId).toBe(bid);
    expect(res.body.businessContext.businessName).toBe('Acme');
    expect(res.body.businessContext.confirmedAt).toBeTruthy();
    expect(res.body.adsReadiness.ok).toBe(false);
  });

  it('sets owner primaryBusinessId when intake is confirmed', async () => {
    const { bid } = await draftAndConfirm('primary-on-confirm@test.com');
    const bc = await mongoose.model('BusinessContext').findOne({ businessId: bid }).lean();
    const owner = await User.findById(bc.userId).lean();
    expect(owner.primaryBusinessId.toString()).toBe(bid);
  });

  it('GET 403 for another users business', async () => {
    const { bid } = await draftAndConfirm('get_owner2@test.com');
    const { agent: otherAgent } = await registerAgent(app, 'get_other@test.com');

    const res = await otherAgent.get(`/api/v1/business-contexts/${bid}`).expect(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('rejects confirmation without businessName', async () => {
    const { agent } = await registerAgent(app, 'no_name@test.com');
    const draft = await agent.post('/api/v1/onboarding/business').expect(201);
    const bid = draft.body.businessId;

    const res = await agent.put(`/api/v1/business-contexts/${bid}`).send({
      industry: 'Tech',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
    expect(res.body.message).toMatch(/businessName/i);
  });

  it('returns 400 for invalid businessId', async () => {
    const { agent } = await registerAgent(app, 'bad_bid@test.com');
    const res = await agent.put('/api/v1/business-contexts/not-an-object-id').send({
      businessName: 'X',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('422-ish validation for invalid services type', async () => {
    const { agent } = await registerAgent(app, 'svc@test.com');
    const draft = await agent.post('/api/v1/onboarding/business').expect(201);
    const bid = draft.body.businessId;

    const res = await agent.put(`/api/v1/business-contexts/${bid}`).send({
      services: 'not-array',
    });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('403 when updating another users business', async () => {
    const { bid } = await draftAndConfirm('owner@test.com');
    const { agent: otherAgent } = await registerAgent(app, 'other@test.com');

    const res = await otherAgent.put(`/api/v1/business-contexts/${bid}`).send({ businessName: 'X' }).expect(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('clears optional fields with empty string', async () => {
    const { agent, bid } = await draftAndConfirm('clear@test.com');

    const res = await agent.put(`/api/v1/business-contexts/${bid}`).send({
      differentiators: '',
    });

    expect(res.status).toBe(200);
    expect(res.body.businessContext.differentiators).toBeNull();
  });

  it('bumps susoVersion only when Step 0 fields change', async () => {
    const { agent, bid } = await draftAndConfirm('step0-bump@test.com');

    const first = await agent
      .put(`/api/v1/business-contexts/${bid}`)
      .send({
        uvp: 'Initial UVP',
        businessScope: 'local_service',
        valueComplexity: 'low_value_low_complexity',
        budgetTier: 'starter',
      })
      .expect(200);
    expect(first.body.businessContext.susoVersion).toBe(1);

    const unchanged = await agent
      .put(`/api/v1/business-contexts/${bid}`)
      .send({
        uvp: 'Initial UVP',
        businessScope: 'local_service',
        valueComplexity: 'low_value_low_complexity',
        budgetTier: 'starter',
      })
      .expect(200);
    expect(unchanged.body.businessContext.susoVersion).toBe(1);

    const bumped = await agent
      .put(`/api/v1/business-contexts/${bid}`)
      .send({ budgetTier: 'growth' })
      .expect(200);
    expect(bumped.body.businessContext.susoVersion).toBe(2);
  });

  describe('SOFT_LAUNCH_MODE Step 0 defaults on confirm', () => {
    const originalFlag = process.env.SOFT_LAUNCH_MODE;

    afterEach(() => {
      if (originalFlag === undefined) {
        delete process.env.SOFT_LAUNCH_MODE;
      } else {
        process.env.SOFT_LAUNCH_MODE = originalFlag;
      }
    });

    it('applies Step 0 defaults on first confirm without Step 0 body and bumps susoVersion', async () => {
      process.env.SOFT_LAUNCH_MODE = 'true';
      const { agent } = await registerAgent(app, 'sl-defaults@test.com');
      const draft = await agent.post('/api/v1/onboarding/business').expect(201);
      const bid = draft.body.businessId;

      const res = await agent
        .put(`/api/v1/business-contexts/${bid}`)
        .send({
          businessName: 'Acme',
          websiteUrl: 'https://example.com',
          services: ['Plumbing'],
          serviceAreas: ['Metro'],
          goals: { primary: 'forms' },
        })
        .expect(200);

      expect(res.body.businessContext.uvp).toBe('Soft-launch default — operator to refine');
      expect(res.body.businessContext.businessScope).toBe('local_service');
      expect(res.body.businessContext.valueComplexity).toBe('low_value_low_complexity');
      expect(res.body.businessContext.budgetTier).toBe('starter');
      expect(res.body.businessContext.susoVersion).toBe(1);
    });

    it('does not overwrite explicit Step 0 values sent in confirm body', async () => {
      process.env.SOFT_LAUNCH_MODE = 'true';
      const { agent } = await registerAgent(app, 'sl-explicit@test.com');
      const draft = await agent.post('/api/v1/onboarding/business').expect(201);
      const bid = draft.body.businessId;

      const res = await agent
        .put(`/api/v1/business-contexts/${bid}`)
        .send({
          businessName: 'Acme',
          websiteUrl: 'https://example.com',
          services: ['Plumbing'],
          serviceAreas: ['Metro'],
          goals: { primary: 'forms' },
          uvp: 'Custom UVP',
          businessScope: 'regional',
          valueComplexity: 'high_value_high_complexity',
          budgetTier: 'growth',
        })
        .expect(200);

      expect(res.body.businessContext.uvp).toBe('Custom UVP');
      expect(res.body.businessContext.businessScope).toBe('regional');
      expect(res.body.businessContext.valueComplexity).toBe('high_value_high_complexity');
      expect(res.body.businessContext.budgetTier).toBe('growth');
    });

    it('does not bump susoVersion again when defaults are unchanged on re-PUT', async () => {
      process.env.SOFT_LAUNCH_MODE = 'true';
      const { agent } = await registerAgent(app, 'sl-reput@test.com');
      const draft = await agent.post('/api/v1/onboarding/business').expect(201);
      const bid = draft.body.businessId;

      const first = await agent
        .put(`/api/v1/business-contexts/${bid}`)
        .send({
          businessName: 'Acme',
          websiteUrl: 'https://example.com',
          services: ['Plumbing'],
          serviceAreas: ['Metro'],
          goals: { primary: 'forms' },
        })
        .expect(200);
      expect(first.body.businessContext.susoVersion).toBe(1);

      const second = await agent
        .put(`/api/v1/business-contexts/${bid}`)
        .send({
          businessName: 'Acme',
          websiteUrl: 'https://example.com',
          services: ['Plumbing'],
          serviceAreas: ['Metro'],
          goals: { primary: 'forms' },
        })
        .expect(200);
      expect(second.body.businessContext.susoVersion).toBe(1);
    });
  });

  it('GET allows platform admin to read another users business', async () => {
    const { bid } = await draftAndConfirm('owner_platform_admin_get@test.com');
    const { agent: adminAgent, userId: adminUserId } = await registerAgent(
      app,
      'platform_admin_get@test.com',
    );
    await User.findByIdAndUpdate(adminUserId, { $set: { platformAdmin: true } });

    const res = await adminAgent.get(`/api/v1/business-contexts/${bid}`).expect(200);
    expect(res.body.businessContext.businessId).toBe(bid);
    expect(res.body.businessContext.businessName).toBe('Acme');
  });
});
