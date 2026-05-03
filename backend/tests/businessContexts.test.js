'use strict';

jest.mock('../lib/temporalClient', () => ({
  getTemporalClient: jest.fn(),
}));

const { getTemporalClient } = require('../lib/temporalClient');
const { createApp } = require('../app');
const { registerAgent } = require('./helpers');

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
    await agent
      .post(`/api/v1/onboarding/business/${bid}/scrape`)
      .send({ websiteUrl: 'https://example.com' })
      .expect(202);

    const res = await agent.put(`/api/v1/business-contexts/${bid}`).send({
      businessName: 'Acme',
      services: [' one ', 'two'],
      contactMethods: { phone: '1' },
    });

    expect(res.status).toBe(200);
    expect(res.body.businessContext.confirmedAt).toBeTruthy();

    return { agent, bid };
  }

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

  it('404 when updating another users business', async () => {
    const { bid } = await draftAndConfirm('owner@test.com');
    const { agent: otherAgent } = await registerAgent(app, 'other@test.com');

    await otherAgent.put(`/api/v1/business-contexts/${bid}`).send({ businessName: 'X' }).expect(404);
  });

  it('clears optional fields with empty string', async () => {
    const { agent, bid } = await draftAndConfirm('clear@test.com');

    const res = await agent.put(`/api/v1/business-contexts/${bid}`).send({
      differentiators: '',
    });

    expect(res.status).toBe(200);
    expect(res.body.businessContext.differentiators).toBeNull();
  });
});
