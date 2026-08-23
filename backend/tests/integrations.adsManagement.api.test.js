'use strict';

const mongoose = require('mongoose');
const { createApp } = require('../app');
const { registerAgent } = require('./helpers');

jest.mock('../services/integrations/googleAdsCampaignClient', () => ({
  enableAdsCampaign: jest.fn(),
  pauseAdsCampaign: jest.fn(),
  updateCampaignBudget: jest.fn(),
  getAdsCampaignLiveState: jest.fn(),
  isCampaignBudgetResourceName: jest.fn((value) =>
    /^customers\/\d+\/campaignBudgets\/\d+$/.test(String(value ?? '').trim())
  ),
}));

const {
  enableAdsCampaign,
  pauseAdsCampaign,
  updateCampaignBudget,
  getAdsCampaignLiveState,
} = require('../services/integrations/googleAdsCampaignClient');

describe('integrations ads management API', () => {
  const app = createApp();

  async function confirmedBusiness(email) {
    const { agent, userId } = await registerAgent(app, email);
    const draft = await agent.post('/api/v1/onboarding/business').expect(201);
    const bid = draft.body.businessId;
    await agent.put(`/api/v1/business-contexts/${bid}`).send({ businessName: 'Co' }).expect(200);
    return { agent, bid, userId };
  }

  async function seedCampaignArtifact(businessId) {
    const SetupRun = mongoose.model('SetupRun');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const run = await SetupRun.create({ businessId, status: 'SUCCEEDED' });
    await IntegrationArtifact.create({
      setupRunId: run._id,
      businessId,
      provider: 'google_ads',
      artifactType: 'ads_campaign',
      externalId: 'customers/1234567890/campaigns/99',
      metadata: { budgetResourceName: 'customers/1234567890/campaignBudgets/42' },
      idempotencyKey: `api-${run._id}-campaign`,
    });
    await IntegrationArtifact.create({
      setupRunId: run._id,
      businessId,
      provider: 'google_ads',
      artifactType: 'ads_campaign_budget',
      externalId: 'customers/1234567890/campaignBudgets/42',
      idempotencyKey: `api-${run._id}-budget`,
    });
    return run;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ADS_BUDGET_MAX_MICROS;
    getAdsCampaignLiveState.mockResolvedValue({
      status: 'PAUSED',
      budgetResourceName: 'customers/1234567890/campaignBudgets/42',
      amountMicros: 10_000_000,
      source: 'google_ads_api_mock',
    });
  });

  it('GET /google_ads/campaign requires auth', async () => {
    await registerAgent(app, 'ads-mgmt-noauth@test.com');
    await require('supertest')(app)
      .get('/api/v1/integrations/google_ads/campaign')
      .query({ businessId: new mongoose.Types.ObjectId().toString() })
      .expect(401);
  });

  it('GET /google_ads/campaign returns campaign state for owner', async () => {
    const { agent, bid } = await confirmedBusiness('ads-mgmt-get@test.com');
    await seedCampaignArtifact(bid);

    const res = await agent
      .get('/api/v1/integrations/google_ads/campaign')
      .query({ businessId: bid })
      .expect(200);

    expect(res.body.campaign.status).toBe('PAUSED');
    expect(res.body.campaign.campaignResourceName).toBe('customers/1234567890/campaigns/99');
  });

  it('POST /google_ads/campaign/enable delegates to management service', async () => {
    const { agent, bid } = await confirmedBusiness('ads-mgmt-enable@test.com');
    await seedCampaignArtifact(bid);
    enableAdsCampaign.mockResolvedValue({ outcome: 'enabled', source: 'google_ads_api_mock' });
    getAdsCampaignLiveState
      .mockResolvedValueOnce({
        status: 'PAUSED',
        budgetResourceName: 'customers/1234567890/campaignBudgets/42',
        amountMicros: 10_000_000,
        source: 'google_ads_api_mock',
      })
      .mockResolvedValueOnce({
        status: 'ENABLED',
        budgetResourceName: 'customers/1234567890/campaignBudgets/42',
        amountMicros: 10_000_000,
        source: 'google_ads_api_mock',
      });

    const res = await agent
      .post('/api/v1/integrations/google_ads/campaign/enable')
      .send({ businessId: bid })
      .expect(200);

    expect(res.body.outcome).toBe('enabled');
    expect(enableAdsCampaign).toHaveBeenCalled();
  });

  it('PATCH /google_ads/campaign/budget rejects amounts above server max', async () => {
    process.env.ADS_BUDGET_MAX_MICROS = '20000000';
    const { agent, bid } = await confirmedBusiness('ads-mgmt-budget-max@test.com');
    await seedCampaignArtifact(bid);

    const res = await agent
      .patch('/api/v1/integrations/google_ads/campaign/budget')
      .send({ businessId: bid, amountMicros: 50_000_000 })
      .expect(400);

    expect(res.body.error).toBe('ADS_CAMPAIGN_BUDGET_MAX_EXCEEDED');
    expect(updateCampaignBudget).not.toHaveBeenCalled();
  });
});
