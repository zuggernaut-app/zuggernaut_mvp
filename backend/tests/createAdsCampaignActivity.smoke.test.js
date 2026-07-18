'use strict';

// TEMPORARY: smoke test for `createAdsCampaignActivity`.
// Delete after the real geo-resolution flow is verified end-to-end.

jest.mock('../services/capabilities', () => {
  const actual = jest.requireActual('../services/capabilities');
  return {
    ...actual,
    createAdsAutoCampaign: jest.fn().mockResolvedValue({
      idempotent: false,
      source: 'google_ads_api_mock',
      summary: {
        campaignCreated: true,
        adGroupCreated: true,
        adCreated: true,
        reusedArtifacts: 0,
        campaignExternalId: 'customers/123/campaigns/zug-campaign-mock',
        adGroupExternalId: 'customers/123/adGroups/zug-adgroup-mock',
        adExternalId: 'customers/123/adGroupAds/zug-ad-mock',
        budgetExternalId: 'customers/123/campaignBudgets/zug-budget-mock',
        conversionLinkCount: 1,
        conversionGoalLinked: true,
        geoTargetsCreated: 1,
      },
    }),
  };
});

const mongoose = require('mongoose');
const { SETUP_STEP_NAMES } = require('../constants/setupWorkflow');
const capabilities = require('../services/capabilities');
const { createAdsCampaignActivity } = require('../activities/setupRunActivities');
const { buildMinimalAdsReadyBusinessContext } = require('../services/capabilities/businessContextAdsReadinessService');

describe('createAdsCampaignActivity smoke test (mocked capability)', () => {
  async function seedRun(email) {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');

    const user = await User.create({ email });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      ...buildMinimalAdsReadyBusinessContext(),
    });

    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });
    return { bc, run };
  }

  it('marks step success + setup run succeeded when createAdsAutoCampaign resolves', async () => {
    jest.clearAllMocks();

    const { bc, run } = await seedRun('act-create-campaign-smoke@test.com');

    const out = await createAdsCampaignActivity({
      setupRunId: run._id.toString(),
      businessId: bc.businessId.toString(),
    });

    expect(out.outcome).toBe('ok');
    expect(capabilities.createAdsAutoCampaign).toHaveBeenCalledTimes(1);

    const updated = await mongoose.model('SetupRun').findById(run._id).lean();
    expect(updated.status).toBe('SUCCEEDED');

    const step = await mongoose.model('SetupStepExecution').findOne({
      setupRunId: run._id,
      stepName: SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
    }).lean();
    expect(step.status).toBe('success');
  });
});

