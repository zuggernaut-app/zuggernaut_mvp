'use strict';

const mongoose = require('mongoose');
const {
  getCampaignForBusiness,
  enableCampaignForBusiness,
  pauseCampaignForBusiness,
  updateBudgetForBusiness,
  AdsCampaignManagementError,
} = require('../services/capabilities/adsCampaignManagementService');

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

describe('adsCampaignManagementService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ADS_BUDGET_MAX_MICROS;
  });

  async function seedBusinessWithCampaign(metadata = {}) {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');

    const user = await User.create({ email: `mgmt-${Date.now()}@test.com` });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      websiteUrl: 'https://acme.example',
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'SUCCEEDED' });
    const campaignArtifact = await IntegrationArtifact.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      provider: 'google_ads',
      artifactType: 'ads_campaign',
      externalId: 'customers/1234567890/campaigns/99',
      metadata: {
        budgetResourceName: 'customers/1234567890/campaignBudgets/42',
        ...metadata,
      },
      idempotencyKey: `mgmt-${run._id}-campaign`,
    });
    await IntegrationArtifact.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      provider: 'google_ads',
      artifactType: 'ads_campaign_budget',
      externalId: 'customers/1234567890/campaignBudgets/42',
      idempotencyKey: `mgmt-${run._id}-budget`,
    });

    return { user, bc, run, campaignArtifact };
  }

  it('getCampaignForBusiness returns live campaign state for owner', async () => {
    const { user, bc } = await seedBusinessWithCampaign();
    getAdsCampaignLiveState.mockResolvedValue({
      status: 'PAUSED',
      budgetResourceName: 'customers/1234567890/campaignBudgets/42',
      amountMicros: 10_000_000,
      source: 'google_ads_api_mock',
    });

    const result = await getCampaignForBusiness(user._id.toString(), bc.businessId.toString());

    expect(result.campaignResourceName).toBe('customers/1234567890/campaigns/99');
    expect(result.status).toBe('PAUSED');
    expect(result.amountMicros).toBe(10_000_000);
  });

  it('enableCampaignForBusiness is a no-op when already enabled', async () => {
    const { user, bc } = await seedBusinessWithCampaign();
    getAdsCampaignLiveState.mockResolvedValue({
      status: 'ENABLED',
      budgetResourceName: 'customers/1234567890/campaignBudgets/42',
      amountMicros: 10_000_000,
      source: 'google_ads_api_mock',
    });

    const result = await enableCampaignForBusiness(user._id.toString(), bc.businessId.toString());

    expect(result.outcome).toBe('no_op_already_enabled');
    expect(enableAdsCampaign).not.toHaveBeenCalled();
  });

  it('updateBudgetForBusiness rejects budgets above configured max', async () => {
    process.env.ADS_BUDGET_MAX_MICROS = '20000000';
    const { user, bc } = await seedBusinessWithCampaign();

    await expect(
      updateBudgetForBusiness(user._id.toString(), bc.businessId.toString(), 50_000_000)
    ).rejects.toThrow(AdsCampaignManagementError);

    expect(updateCampaignBudget).not.toHaveBeenCalled();
  });

  it('pauseCampaignForBusiness calls provider pause when not already paused', async () => {
    const { user, bc } = await seedBusinessWithCampaign();
    getAdsCampaignLiveState
      .mockResolvedValueOnce({
        status: 'ENABLED',
        budgetResourceName: 'customers/1234567890/campaignBudgets/42',
        amountMicros: 10_000_000,
        source: 'google_ads_api',
      })
      .mockResolvedValueOnce({
        status: 'PAUSED',
        budgetResourceName: 'customers/1234567890/campaignBudgets/42',
        amountMicros: 10_000_000,
        source: 'google_ads_api',
      });
    pauseAdsCampaign.mockResolvedValue({ outcome: 'paused', source: 'google_ads_api' });

    const result = await pauseCampaignForBusiness(user._id.toString(), bc.businessId.toString());

    expect(pauseAdsCampaign).toHaveBeenCalledWith({
      businessId: bc.businessId,
      campaignResourceName: 'customers/1234567890/campaigns/99',
    });
    expect(result.outcome).toBe('paused');
    expect(result.status).toBe('PAUSED');
  });
});
