'use strict';

const axios = require('axios');
const {
  createDiagnosticSearchCampaign,
  createDiagnosticAdGroup,
} = require('../services/integrations/googleAdsCreationDiagnosticsClient');

jest.mock('axios');
jest.mock('../services/integrations/googleTokenService', () => ({
  getFreshGoogleAccessToken: jest.fn().mockResolvedValue('fresh-token'),
}));

describe('googleAdsCreationDiagnosticsClient (Phase 9)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GOOGLE_ADS_API_MOCK;
    process.env.GOOGLE_ADS_API_ENABLED = 'true';
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
  });

  it('creates paused campaigns and ad groups (never enabled)', async () => {
    axios.post.mockImplementation((url, body) => {
      if (url.includes('/campaigns:mutate')) {
        return Promise.resolve({
          status: 200,
          data: { results: [{ resourceName: 'customers/123/campaigns/456' }] },
        });
      }
      if (url.includes('/adGroups:mutate')) {
        return Promise.resolve({
          status: 200,
          data: { results: [{ resourceName: 'customers/123/adGroups/789' }] },
        });
      }
      return Promise.resolve({ status: 200, data: { results: [{ resourceName: 'x' }] } });
    });

    await createDiagnosticSearchCampaign({
      businessId: 'biz',
      customerId: '123',
      resourceLabel: 'ZUG_DEV_TEST_campaign',
      budgetResourceName: 'customers/123/campaignBudgets/1',
    });

    const campaignCall = axios.post.mock.calls.find(([url]) => url.includes('/campaigns:mutate'));
    expect(campaignCall[1].operations[0].create.status).toBe('PAUSED');
    expect(campaignCall[1].operations[0].create.containsEuPoliticalAdvertising).toBe(
      'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
    );
    expect(campaignCall[1].operations[0].create.manualCpc).toEqual({
      enhancedCpcEnabled: false,
    });

    await createDiagnosticAdGroup({
      businessId: 'biz',
      customerId: '123',
      resourceLabel: 'ZUG_DEV_TEST_adgroup',
      campaignResourceName: 'customers/123/campaigns/456',
    });

    const adGroupCall = axios.post.mock.calls.find(([url]) => url.includes('/adGroups:mutate'));
    expect(adGroupCall[1].operations[0].create.status).toBe('PAUSED');
  });
});
