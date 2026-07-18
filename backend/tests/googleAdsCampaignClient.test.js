'use strict';

const axios = require('axios');
const {
  buildCustomConversionGoalCreatePayload,
  buildConversionGoalCampaignConfigUpdateOperation,
  buildFindCampaignByNameQuery,
  buildFindAdGroupByNameQuery,
  buildFindKeywordByTextQuery,
  buildFindCampaignGeoTargetQuery,
  buildFindCustomConversionGoalByNameQuery,
  buildAdGroupKeywordCreatePayload,
  buildCampaignGeoTargetCreatePayload,
  buildResponsiveSearchAdCreatePayload,
  buildSearchCampaignCreatePayload,
  createAdGroup,
  createAdGroupKeyword,
  createCampaignGeoTarget,
  createCampaign,
  createCustomConversionGoal,
  createResponsiveSearchAd,
  escapeGaqlLiteral,
  linkCampaignToCustomConversionGoal,
} = require('../services/integrations/googleAdsCampaignClient');
const { buildMinimalCampaignIntent } = require('../services/capabilities/adsCampaignIntentService');

function clientIntent(overrides = {}) {
  return buildMinimalCampaignIntent({
    businessName: 'MioSalon',
    campaign: {
      name: 'MioSalon — Zuggernaut Search',
      ...(overrides.campaign ?? {}),
    },
    adGroup: {
      name: 'MioSalon — Core',
      ...(overrides.adGroup ?? {}),
    },
    ad: {
      finalUrl: 'https://example.com',
      headlines: ['MioSalon', 'Salon software in your area', 'Book a demo today'],
      descriptions: ['Trusted salon software.', 'Visit our website to learn more.'],
      ...(overrides.ad ?? {}),
    },
    ...overrides,
  });
}

jest.mock('axios');
jest.mock('../services/integrations/googleTokenService', () => ({
  getFreshGoogleAccessToken: jest.fn().mockResolvedValue('test-access-token'),
}));

describe('googleAdsCampaignClient', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
    delete process.env.GOOGLE_ADS_API_MOCK;
    process.env.GOOGLE_ADS_API_ENABLED = 'true';
  });

  it('buildSearchCampaignCreatePayload matches dev integrations write contract', () => {
    const payload = buildSearchCampaignCreatePayload({
      name: 'Acme — Zuggernaut Search',
      campaignBudget: 'customers/123/campaignBudgets/1',
    });

    expect(payload).toEqual({
      name: 'Acme — Zuggernaut Search',
      advertisingChannelType: 'SEARCH',
      status: 'PAUSED',
      campaignBudget: 'customers/123/campaignBudgets/1',
      containsEuPoliticalAdvertising: 'DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING',
      manualCpc: { enhancedCpcEnabled: false },
      networkSettings: {
        targetGoogleSearch: true,
        targetSearchNetwork: true,
        targetContentNetwork: false,
      },
    });
    expect(payload.maximizeConversions).toBeUndefined();
  });

  it('escapeGaqlLiteral escapes quotes for campaign name search', () => {
    expect(escapeGaqlLiteral("O'Brien")).toBe("O\\'Brien");
    expect(buildFindCampaignByNameQuery("O'Brien — Zuggernaut Search")).toContain(
      "campaign.name = 'O\\'Brien — Zuggernaut Search'"
    );
  });

  it('createCampaign searches by name before mutate when no existing campaign', async () => {
    axios.post
      .mockResolvedValueOnce({ status: 200, data: { results: [] } })
      .mockResolvedValueOnce({
        status: 200,
        data: { results: [{ resourceName: 'customers/123/campaigns/456' }] },
      });

    const result = await createCampaign({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '1234567890',
      setupRunId: 'run-abc',
      budgetResourceName: 'customers/1234567890/campaignBudgets/99',
      intent: clientIntent(),
    });

    expect(result).toEqual({
      resourceName: 'customers/123/campaigns/456',
      source: 'google_ads_api',
    });
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.post.mock.calls[0][0]).toContain('/googleAds:search');
    expect(axios.post.mock.calls[1][0]).toContain('/campaigns:mutate');

    const [, mutateBody] = axios.post.mock.calls[1];
    const create = mutateBody.operations[0].create;
    expect(create.manualCpc).toEqual({ enhancedCpcEnabled: false });
    expect(create.containsEuPoliticalAdvertising).toBe('DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING');
    expect(create.maximizeConversions).toBeUndefined();
    expect(create.status).toBe('PAUSED');
  });

  it('createCampaign reuses existing campaign when search finds a match', async () => {
    axios.post.mockResolvedValueOnce({
      status: 200,
      data: {
        results: [{ campaign: { resourceName: 'customers/123/campaigns/789' } }],
      },
    });

    const result = await createCampaign({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '1234567890',
      setupRunId: 'run-new',
      budgetResourceName: 'customers/1234567890/campaignBudgets/99',
      intent: clientIntent(),
    });

    expect(result).toEqual({
      resourceName: 'customers/123/campaigns/789',
      source: 'google_ads_api_reused',
    });
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toContain('/googleAds:search');
  });

  it('createCampaign recovers from DUPLICATE_CAMPAIGN_NAME by re-searching', async () => {
    axios.post
      .mockResolvedValueOnce({ status: 200, data: { results: [] } })
      .mockResolvedValueOnce({
        status: 400,
        data: {
          error: {
            status: 'INVALID_ARGUMENT',
            message: 'Request contains an invalid argument.',
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.BadRequest',
                fieldViolations: [
                  {
                    field: 'operations[0].create.name',
                    description:
                      'campaignError:DUPLICATE_CAMPAIGN_NAME — Trying to modify the name of an active or paused campaign, where the name is already assigned to another active or paused campaign.',
                  },
                ],
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          results: [{ campaign: { resourceName: 'customers/123/campaigns/999' } }],
        },
      });

    const result = await createCampaign({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '1234567890',
      setupRunId: 'run-retry',
      budgetResourceName: 'customers/1234567890/campaignBudgets/99',
      intent: clientIntent(),
    });

    expect(result).toEqual({
      resourceName: 'customers/123/campaigns/999',
      source: 'google_ads_api_reused',
    });
    expect(axios.post).toHaveBeenCalledTimes(3);
  });

  it('buildFindAdGroupByNameQuery scopes search to campaign and ad group name', () => {
    expect(
      buildFindAdGroupByNameQuery(
        "O'Brien — Core",
        'customers/1234567890/campaigns/456'
      )
    ).toContain("ad_group.name = 'O\\'Brien — Core'");
    expect(
      buildFindAdGroupByNameQuery(
        "O'Brien — Core",
        'customers/1234567890/campaigns/456'
      )
    ).toContain("campaign.resource_name = 'customers/1234567890/campaigns/456'");
  });

  it('buildAdGroupKeywordCreatePayload builds paused PHRASE keyword criterion', () => {
    const payload = buildAdGroupKeywordCreatePayload({
      adGroupResourceName: 'customers/1234567890/adGroups/99',
      keywordText: 'plumbing Springfield',
      matchType: 'PHRASE',
    });

    expect(payload).toEqual({
      adGroup: 'customers/1234567890/adGroups/99',
      status: 'PAUSED',
      keyword: {
        text: 'plumbing Springfield',
        matchType: 'PHRASE',
      },
    });
  });

  it('buildAdGroupKeywordCreatePayload sanitizes unsafe keyword text before mutate', () => {
    const payload = buildAdGroupKeywordCreatePayload({
      adGroupResourceName: 'customers/1234567890/adGroups/99',
      keywordText: 'tax prep & bookkeeping',
      matchType: 'PHRASE',
    });

    expect(payload.keyword.text).toBe('tax prep bookkeeping');
  });

  it('buildAdGroupKeywordCreatePayload rejects keywords that sanitize to empty', () => {
    expect(() =>
      buildAdGroupKeywordCreatePayload({
        adGroupResourceName: 'customers/1234567890/adGroups/99',
        keywordText: '(((( ))))',
        matchType: 'PHRASE',
      })
    ).toThrow('Keyword text is required after Google Ads compliance sanitization.');
  });

  it('buildFindKeywordByTextQuery scopes search to ad group and keyword text', () => {
    const query = buildFindKeywordByTextQuery(
      'customers/1234567890/adGroups/99',
      "plumber's service",
      'PHRASE'
    );

    expect(query).toContain("ad_group.resource_name = 'customers/1234567890/adGroups/99'");
    expect(query).toContain("ad_group_criterion.keyword.text = 'plumber\\'s service'");
    expect(query).toContain("ad_group_criterion.keyword.match_type = 'PHRASE'");
  });

  it('buildCampaignGeoTargetCreatePayload builds location campaign criterion', () => {
    const payload = buildCampaignGeoTargetCreatePayload({
      campaignResourceName: 'customers/1234567890/campaigns/456',
      geoTargetConstant: 'geoTargetConstants/1014044',
    });

    expect(payload).toEqual({
      campaign: 'customers/1234567890/campaigns/456',
      location: {
        geoTargetConstant: 'geoTargetConstants/1014044',
      },
    });
  });

  it('buildFindCampaignGeoTargetQuery scopes search to campaign and geo constant', () => {
    const query = buildFindCampaignGeoTargetQuery(
      'customers/1234567890/campaigns/456',
      'geoTargetConstants/1014044'
    );

    expect(query).toContain("campaign.resource_name = 'customers/1234567890/campaigns/456'");
    expect(query).toContain("campaign_criterion.type = 'LOCATION'");
    expect(query).toContain(
      "campaign_criterion.location.geo_target_constant = 'geoTargetConstants/1014044'"
    );
  });

  it('createCampaignGeoTarget searches before mutate when no existing criterion', async () => {
    axios.post
      .mockResolvedValueOnce({ status: 200, data: { results: [] } })
      .mockResolvedValueOnce({
        status: 200,
        data: { results: [{ resourceName: 'customers/123/campaignCriteria/456' }] },
      });

    const result = await createCampaignGeoTarget({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '1234567890',
      setupRunId: 'run-geo',
      campaignResourceName: 'customers/1234567890/campaigns/456',
      geoTargetConstant: 'geoTargetConstants/1014044',
      geoIndex: 0,
    });

    expect(result).toEqual({
      resourceName: 'customers/123/campaignCriteria/456',
      source: 'google_ads_api',
    });
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.post.mock.calls[0][0]).toContain('/googleAds:search');
    expect(axios.post.mock.calls[1][0]).toContain('/campaignCriteria:mutate');

    const [, mutateBody] = axios.post.mock.calls[1];
    expect(mutateBody.operations[0].create).toEqual({
      campaign: 'customers/1234567890/campaigns/456',
      location: { geoTargetConstant: 'geoTargetConstants/1014044' },
    });
  });

  it('createCampaignGeoTarget reuses existing criterion when search finds a match', async () => {
    axios.post.mockResolvedValueOnce({
      status: 200,
      data: {
        results: [{ campaignCriterion: { resourceName: 'customers/123/campaignCriteria/999' } }],
      },
    });

    const result = await createCampaignGeoTarget({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '1234567890',
      setupRunId: 'run-geo-reuse',
      campaignResourceName: 'customers/1234567890/campaigns/456',
      geoTargetConstant: 'geoTargetConstants/1014044',
      geoIndex: 0,
    });

    expect(result).toEqual({
      resourceName: 'customers/123/campaignCriteria/999',
      source: 'google_ads_api_reused',
    });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('createAdGroupKeyword searches by text before mutate when no existing keyword', async () => {
    axios.post
      .mockResolvedValueOnce({ status: 200, data: { results: [] } })
      .mockResolvedValueOnce({
        status: 200,
        data: { results: [{ resourceName: 'customers/123/adGroupCriteria/456' }] },
      });

    const result = await createAdGroupKeyword({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '1234567890',
      setupRunId: 'run-abc',
      adGroupResourceName: 'customers/1234567890/adGroups/99',
      keywordText: 'plumbing Springfield',
      matchType: 'PHRASE',
      keywordIndex: 0,
    });

    expect(result).toEqual({
      resourceName: 'customers/123/adGroupCriteria/456',
      source: 'google_ads_api',
    });
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.post.mock.calls[0][0]).toContain('/googleAds:search');
    expect(axios.post.mock.calls[1][0]).toContain('/adGroupCriteria:mutate');

    const [, mutateBody] = axios.post.mock.calls[1];
    expect(mutateBody.operations[0].create).toEqual({
      adGroup: 'customers/1234567890/adGroups/99',
      status: 'PAUSED',
      keyword: { text: 'plumbing Springfield', matchType: 'PHRASE' },
    });
  });

  it('createAdGroupKeyword reuses existing keyword when search finds a match', async () => {
    axios.post.mockResolvedValueOnce({
      status: 200,
      data: {
        results: [{ adGroupCriterion: { resourceName: 'customers/123/adGroupCriteria/999' } }],
      },
    });

    const result = await createAdGroupKeyword({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '1234567890',
      setupRunId: 'run-new',
      adGroupResourceName: 'customers/1234567890/adGroups/99',
      keywordText: 'plumbing Springfield',
      matchType: 'PHRASE',
      keywordIndex: 1,
    });

    expect(result).toEqual({
      resourceName: 'customers/123/adGroupCriteria/999',
      source: 'google_ads_api_reused',
    });
    expect(axios.post).toHaveBeenCalledTimes(1);
  });

  it('createAdGroup searches by name before mutate when no existing ad group', async () => {
    axios.post
      .mockResolvedValueOnce({ status: 200, data: { results: [] } })
      .mockResolvedValueOnce({
        status: 200,
        data: { results: [{ resourceName: 'customers/123/adGroups/456' }] },
      });

    const result = await createAdGroup({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '1234567890',
      setupRunId: 'run-abc',
      campaignResourceName: 'customers/1234567890/campaigns/789',
      intent: clientIntent(),
    });

    expect(result).toEqual({
      resourceName: 'customers/123/adGroups/456',
      source: 'google_ads_api',
    });
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.post.mock.calls[0][0]).toContain('/googleAds:search');
    expect(axios.post.mock.calls[1][0]).toContain('/adGroups:mutate');

    const [, mutateBody] = axios.post.mock.calls[1];
    const create = mutateBody.operations[0].create;
    expect(create.name).toBe('MioSalon — Core');
    expect(create.campaign).toBe('customers/1234567890/campaigns/789');
    expect(create.type).toBe('SEARCH_STANDARD');
    expect(create.status).toBe('PAUSED');
  });

  it('createAdGroup reuses existing ad group when search finds a match', async () => {
    axios.post.mockResolvedValueOnce({
      status: 200,
      data: {
        results: [{ adGroup: { resourceName: 'customers/123/adGroups/999' } }],
      },
    });

    const result = await createAdGroup({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '1234567890',
      setupRunId: 'run-new',
      campaignResourceName: 'customers/1234567890/campaigns/789',
      intent: clientIntent(),
    });

    expect(result).toEqual({
      resourceName: 'customers/123/adGroups/999',
      source: 'google_ads_api_reused',
    });
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toContain('/googleAds:search');
  });

  it('createAdGroup recovers from DUPLICATE_ADGROUP_NAME by re-searching', async () => {
    axios.post
      .mockResolvedValueOnce({ status: 200, data: { results: [] } })
      .mockResolvedValueOnce({
        status: 400,
        data: {
          error: {
            status: 'INVALID_ARGUMENT',
            message: 'Request contains an invalid argument.',
            details: [
              {
                '@type': 'type.googleapis.com/google.rpc.BadRequest',
                fieldViolations: [
                  {
                    field: 'operations[0].create.name',
                    description:
                      'adGroupError:DUPLICATE_ADGROUP_NAME — AdGroup with the same name already exists for the campaign.',
                  },
                ],
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          results: [{ adGroup: { resourceName: 'customers/123/adGroups/888' } }],
        },
      });

    const result = await createAdGroup({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '1234567890',
      setupRunId: 'run-retry',
      campaignResourceName: 'customers/1234567890/campaigns/789',
      intent: clientIntent(),
    });

    expect(result).toEqual({
      resourceName: 'customers/123/adGroups/888',
      source: 'google_ads_api_reused',
    });
    expect(axios.post).toHaveBeenCalledTimes(3);
  });

  it('buildResponsiveSearchAdCreatePayload strict mode rejects insufficient RSA copy', () => {
    expect(() =>
      buildResponsiveSearchAdCreatePayload({
        adGroupResourceName: 'customers/123/adGroups/9',
        finalUrl: 'https://example.com',
        headlines: ['Only one'],
        descriptions: ['Only one description here'],
        strict: true,
      })
    ).toThrow(/at least 3 headlines/);
  });

  it('buildResponsiveSearchAdCreatePayload enforces RSA minimums and character limits', () => {
    const payload = buildResponsiveSearchAdCreatePayload({
      adGroupResourceName: 'customers/123/adGroups/9',
      finalUrl: 'https://www.miosalon.com',
      headlines: [
        'MioSalon',
        'Premium salon software and appointment scheduling in downtown',
        'Get a Free Quote Today',
      ],
      descriptions: [
        'Trusted salon software serving your local area. Contact MioSalon today for a personalized walkthrough of the platform.',
        'Professional services. Visit our website to learn more.',
      ],
      fallbacks: { businessName: 'MioSalon' },
    });

    expect(payload.status).toBe('PAUSED');
    expect(payload.ad.finalUrls).toEqual(['https://www.miosalon.com']);
    expect(payload.ad.responsiveSearchAd.headlines).toHaveLength(3);
    expect(payload.ad.responsiveSearchAd.descriptions).toHaveLength(2);
    expect(payload.ad.responsiveSearchAd.headlines[1].text).toBe('Premium salon software and app');
    expect(payload.ad.responsiveSearchAd.headlines.every((row) => row.text.length <= 30)).toBe(true);
    expect(payload.ad.responsiveSearchAd.descriptions.every((row) => row.text.length <= 90)).toBe(true);
  });

  it('createResponsiveSearchAd uses paused RSA payload for real API writes', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { results: [{ resourceName: 'customers/123/adGroupAds/456' }] },
    });

    await createResponsiveSearchAd({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '1234567890',
      setupRunId: 'run-abc',
      adGroupResourceName: 'customers/1234567890/adGroups/99',
      intent: buildMinimalCampaignIntent({
        businessName: 'MioSalon',
        campaign: { name: 'MioSalon — Zuggernaut Search' },
        ad: {
          finalUrl: 'https://www.miosalon.com',
          headlines: ['MioSalon', 'Salon software in your area', 'Book a demo today'],
          descriptions: ['Trusted salon software.', 'Visit our website to learn more.'],
        },
      }),
    });

    const [, body] = axios.post.mock.calls[0];
    const create = body.operations[0].create;
    expect(create.status).toBe('PAUSED');
    expect(create.ad.responsiveSearchAd.headlines.length).toBeGreaterThanOrEqual(3);
    expect(create.ad.responsiveSearchAd.descriptions.length).toBeGreaterThanOrEqual(2);
  });

  it('buildCustomConversionGoalCreatePayload requires conversion actions', () => {
    expect(() =>
      buildCustomConversionGoalCreatePayload({
        name: 'Acme — Zuggernaut Conversions',
        conversionActionResourceNames: [],
      })
    ).toThrow('at least one conversion action');

    const payload = buildCustomConversionGoalCreatePayload({
      name: 'Acme — Zuggernaut Conversions',
      conversionActionResourceNames: [
        'customers/1234567890/conversionActions/1001',
        'customers/1234567890/conversionActions/1002',
      ],
    });

    expect(payload).toEqual({
      name: 'Acme — Zuggernaut Conversions',
      conversionActions: [
        'customers/1234567890/conversionActions/1001',
        'customers/1234567890/conversionActions/1002',
      ],
      status: 'ENABLED',
    });
  });

  it('buildConversionGoalCampaignConfigUpdateOperation uses update + updateMask', () => {
    const operation = buildConversionGoalCampaignConfigUpdateOperation({
      customerId: '1234567890',
      campaignResourceName: 'customers/1234567890/campaigns/456',
      customConversionGoalResourceName: 'customers/1234567890/customConversionGoals/99',
    });

    expect(operation).toEqual({
      update: {
        resourceName: 'customers/1234567890/conversionGoalCampaignConfigs/456',
        customConversionGoal: 'customers/1234567890/customConversionGoals/99',
      },
      updateMask: 'custom_conversion_goal',
    });
  });

  it('createCustomConversionGoal posts customConversionGoals:mutate create payload', async () => {
    axios.post
      .mockResolvedValueOnce({
        status: 200,
        data: { results: [] },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: { results: [{ resourceName: 'customers/1234567890/customConversionGoals/99' }] },
      });

    const result = await createCustomConversionGoal({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '1234567890',
      setupRunId: 'run-abc',
      name: 'MioSalon — Zuggernaut Conversions',
      conversionActionResourceNames: ['customers/1234567890/conversionActions/1001'],
    });

    expect(result).toEqual({
      resourceName: 'customers/1234567890/customConversionGoals/99',
      source: 'google_ads_api',
    });
    expect(axios.post).toHaveBeenCalledTimes(2);

    const [searchUrl] = axios.post.mock.calls[0];
    expect(searchUrl).toContain('/googleAds:search');

    const [mutateUrl, body] = axios.post.mock.calls[1];
    expect(mutateUrl).toContain('/customConversionGoals:mutate');
    expect(body.operations[0].create).toEqual({
      name: 'MioSalon — Zuggernaut Conversions',
      conversionActions: ['customers/1234567890/conversionActions/1001'],
      status: 'ENABLED',
    });
    expect(body.operations[0].update).toBeUndefined();
  });

  it('createCustomConversionGoal reuses existing goal from lookup without mutate', async () => {
    axios.post.mockResolvedValueOnce({
      status: 200,
      data: {
        results: [
          {
            customConversionGoal: {
              resourceName: 'customers/1234567890/customConversionGoals/42',
              name: 'MioSalon — Zuggernaut Conversions',
            },
          },
        ],
      },
    });

    const result = await createCustomConversionGoal({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '1234567890',
      setupRunId: 'run-abc',
      name: 'MioSalon — Zuggernaut Conversions',
      conversionActionResourceNames: ['customers/1234567890/conversionActions/1001'],
    });

    expect(result).toEqual({
      resourceName: 'customers/1234567890/customConversionGoals/42',
      source: 'google_ads_api_reused',
    });
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.post.mock.calls[0][0]).toContain('/googleAds:search');
  });

  it('createCustomConversionGoal recovers duplicate-name mutate via lookup', async () => {
    axios.post
      .mockResolvedValueOnce({
        status: 200,
        data: { results: [] },
      })
      .mockResolvedValueOnce({
        status: 400,
        data: {
          error: {
            code: 400,
            message: 'Request contains an invalid argument.',
            status: 'INVALID_ARGUMENT',
            details: [
              {
                '@type': 'type.googleapis.com/google.ads.googleads.v24.errors.GoogleAdsFailure',
                errors: [
                  {
                    errorCode: { customConversionGoalError: 'CUSTOM_GOAL_DUPLICATE_NAME' },
                    message: 'Custom goal with the same name already exists.',
                    location: {
                      fieldPathElements: [{ fieldName: 'operations', index: 0 }, { fieldName: 'create' }, { fieldName: 'name' }],
                    },
                  },
                ],
              },
            ],
          },
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          results: [
            {
              customConversionGoal: {
                resourceName: 'customers/1234567890/customConversionGoals/42',
              },
            },
          ],
        },
      });

    const result = await createCustomConversionGoal({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '1234567890',
      setupRunId: 'run-abc',
      name: 'MioSalon — Zuggernaut Conversions',
      conversionActionResourceNames: ['customers/1234567890/conversionActions/1001'],
    });

    expect(result).toEqual({
      resourceName: 'customers/1234567890/customConversionGoals/42',
      source: 'google_ads_api_reused',
    });
    expect(axios.post).toHaveBeenCalledTimes(3);
    expect(axios.post.mock.calls[1][0]).toContain('/customConversionGoals:mutate');
    expect(axios.post.mock.calls[2][0]).toContain('/googleAds:search');
  });

  it('buildFindCustomConversionGoalByNameQuery escapes goal name literals', () => {
    const query = buildFindCustomConversionGoalByNameQuery("Acme's Goal");
    expect(query).toContain("custom_conversion_goal.name = 'Acme\\'s Goal'");
  });

  it('linkCampaignToCustomConversionGoal posts conversionGoalCampaignConfigs:mutate update payload', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { results: [{ resourceName: 'customers/1234567890/conversionGoalCampaignConfigs/456' }] },
    });

    await linkCampaignToCustomConversionGoal({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '1234567890',
      setupRunId: 'run-abc',
      campaignResourceName: 'customers/1234567890/campaigns/456',
      customConversionGoalResourceName: 'customers/1234567890/customConversionGoals/99',
    });

    const [url, body] = axios.post.mock.calls[0];
    expect(url).toContain('/conversionGoalCampaignConfigs:mutate');
    expect(body.operations[0]).toEqual({
      update: {
        resourceName: 'customers/1234567890/conversionGoalCampaignConfigs/456',
        customConversionGoal: 'customers/1234567890/customConversionGoals/99',
      },
      updateMask: 'custom_conversion_goal',
    });
    expect(body.operations[0].create).toBeUndefined();
  });
});
