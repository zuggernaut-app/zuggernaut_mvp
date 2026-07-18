'use strict';

const axios = require('axios');
const {
  resolvePrimaryGeoTargetConstant,
  pickBestGeoSuggestion,
  GeoTargetResolutionError,
} = require('../services/integrations/googleAdsGeoTargetClient');
const { ADS_INTENT_CODES } = require('../constants/adsCampaignIntent');

jest.mock('axios');
jest.mock('../services/integrations/googleTokenService', () => ({
  getFreshGoogleAccessToken: jest.fn().mockResolvedValue('test-access-token'),
}));

describe('googleAdsGeoTargetClient', () => {
  const prevMock = process.env.GOOGLE_ADS_API_MOCK;
  const prevEnabled = process.env.GOOGLE_ADS_API_ENABLED;

  beforeEach(() => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
  });

  afterEach(() => {
    process.env.GOOGLE_ADS_API_MOCK = prevMock;
    process.env.GOOGLE_ADS_API_ENABLED = prevEnabled;
    jest.clearAllMocks();
  });

  it('resolvePrimaryGeoTargetConstant returns deterministic mock geo in mock mode', async () => {
    process.env.GOOGLE_ADS_API_MOCK = 'true';

    const result = await resolvePrimaryGeoTargetConstant({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '1234567890',
      label: 'Springfield',
    });

    expect(result).toEqual({
      resourceName: 'geoTargetConstants/mock-geo-springfield',
      label: 'Springfield',
      canonicalName: 'Springfield, United States',
      targetType: 'City',
      countryCode: 'US',
    });
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('pickBestGeoSuggestion selects a single suggestion', () => {
    const picked = pickBestGeoSuggestion(
      [
        {
          searchTerm: 'Springfield',
          geoTargetConstant: {
            resourceName: 'geoTargetConstants/1014044',
            name: 'Springfield',
            canonicalName: 'Springfield,Illinois,United States',
            targetType: 'City',
            status: 'ENABLED',
          },
        },
      ],
      'Springfield',
      'US'
    );

    expect(picked?.resourceName).toBe('geoTargetConstants/1014044');
  });

  it('pickBestGeoSuggestion resolves exact canonical match when multiple suggestions exist', () => {
    const picked = pickBestGeoSuggestion(
      [
        {
          searchTerm: 'Springfield',
          geoTargetConstant: {
            resourceName: 'geoTargetConstants/1014044',
            name: 'Springfield',
            canonicalName: 'Springfield,Illinois,United States',
            targetType: 'City',
            status: 'ENABLED',
          },
        },
        {
          searchTerm: 'Springfield',
          geoTargetConstant: {
            resourceName: 'geoTargetConstants/1014045',
            name: 'Springfield',
            canonicalName: 'Springfield,Massachusetts,United States',
            targetType: 'City',
            status: 'ENABLED',
          },
        },
      ],
      'Springfield, Illinois',
      'US'
    );

    expect(picked?.resourceName).toBe('geoTargetConstants/1014044');
  });

  it('pickBestGeoSuggestion picks first relevant city when name is ambiguous', () => {
    const picked = pickBestGeoSuggestion(
      [
        {
          geoTargetConstant: {
            resourceName: 'geoTargetConstants/1014044',
            name: 'Springfield',
            canonicalName: 'Springfield,Illinois,United States',
            targetType: 'City',
            countryCode: 'US',
            status: 'ENABLED',
          },
        },
        {
          geoTargetConstant: {
            resourceName: 'geoTargetConstants/1014045',
            name: 'Springfield',
            canonicalName: 'Springfield,Massachusetts,United States',
            targetType: 'City',
            countryCode: 'US',
            status: 'ENABLED',
          },
        },
      ],
      'Springfield',
      'US'
    );

    expect(picked?.resourceName).toBe('geoTargetConstants/1014044');
  });

  it('pickBestGeoSuggestion resolves ambiguous Mountain View cities in target country', () => {
    const picked = pickBestGeoSuggestion(
      [
        {
          searchTerm: 'Mountain View',
          geoTargetConstant: {
            resourceName: 'geoTargetConstants/1014044',
            name: 'Mountain View',
            canonicalName: 'Mountain View,California,United States',
            targetType: 'City',
            countryCode: 'US',
            status: 'ENABLED',
          },
        },
        {
          searchTerm: 'Mountain View',
          geoTargetConstant: {
            resourceName: 'geoTargetConstants/1014999',
            name: 'Mountain View',
            canonicalName: 'Mountain View,Arkansas,United States',
            targetType: 'City',
            countryCode: 'US',
            status: 'ENABLED',
          },
        },
      ],
      'Mountain View',
      'US'
    );

    expect(picked?.resourceName).toBe('geoTargetConstants/1014044');
  });

  it('resolvePrimaryGeoTargetConstant fails with UNRESOLVED_GEO when suggest returns no match', async () => {
    process.env.GOOGLE_ADS_API_MOCK = 'false';
    process.env.GOOGLE_ADS_API_ENABLED = 'true';

    axios.post.mockResolvedValueOnce({
      status: 200,
      data: {
        geoTargetConstantSuggestions: [],
      },
    });

    await expect(
      resolvePrimaryGeoTargetConstant({
        businessId: '507f1f77bcf86cd799439011',
        customerId: '1234567890',
        label: 'Springfield',
      })
    ).rejects.toMatchObject({
      code: ADS_INTENT_CODES.UNRESOLVED_GEO,
    });
  });

  it('resolvePrimaryGeoTargetConstant resolves ambiguous Springfield suggestions', async () => {
    process.env.GOOGLE_ADS_API_MOCK = 'false';
    process.env.GOOGLE_ADS_API_ENABLED = 'true';

    axios.post.mockResolvedValueOnce({
      status: 200,
      data: {
        geoTargetConstantSuggestions: [
          {
            geoTargetConstant: {
              resourceName: 'geoTargetConstants/1014044',
              name: 'Springfield',
              canonicalName: 'Springfield,Illinois,United States',
              targetType: 'City',
              countryCode: 'US',
              status: 'ENABLED',
            },
          },
          {
            geoTargetConstant: {
              resourceName: 'geoTargetConstants/1014045',
              name: 'Springfield',
              canonicalName: 'Springfield,Massachusetts,United States',
              targetType: 'City',
              countryCode: 'US',
              status: 'ENABLED',
            },
          },
        ],
      },
    });

    const result = await resolvePrimaryGeoTargetConstant({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '1234567890',
      label: 'Springfield',
    });

    expect(result.resourceName).toBe('geoTargetConstants/1014044');
    expect(result.label).toBe('Springfield');
  });

  it('resolvePrimaryGeoTargetConstant fails when label is empty', async () => {
    process.env.GOOGLE_ADS_API_MOCK = 'true';

    await expect(
      resolvePrimaryGeoTargetConstant({
        businessId: '507f1f77bcf86cd799439011',
        customerId: '1234567890',
        label: '   ',
      })
    ).rejects.toBeInstanceOf(GeoTargetResolutionError);
  });

  it('resolvePrimaryGeoTargetConstant falls back to United States when suggest returns 404', async () => {
    process.env.GOOGLE_ADS_API_MOCK = 'false';
    process.env.GOOGLE_ADS_API_ENABLED = 'true';

    axios.post
      .mockResolvedValueOnce({ status: 404, data: {} })
      .mockResolvedValueOnce({
        status: 200,
        data: {
          geoTargetConstantSuggestions: [
            {
              searchTerm: 'United States',
              geoTargetConstant: {
                resourceName: 'geoTargetConstants/2840',
                name: 'United States',
                canonicalName: 'United States',
                targetType: 'Country',
                countryCode: 'US',
                status: 'ENABLED',
              },
            },
          ],
        },
      });

    const result = await resolvePrimaryGeoTargetConstant({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '1234567890',
      label: 'miosalon.com area',
    });

    expect(result.resourceName).toBe('geoTargetConstants/2840');
    expect(result.label).toBe('miosalon.com area');
    expect(axios.post).toHaveBeenCalledTimes(2);
  });

  it('uses geoTargetConstants:suggest without a customer-scoped path prefix', async () => {
    process.env.GOOGLE_ADS_API_MOCK = 'false';
    process.env.GOOGLE_ADS_API_ENABLED = 'true';

    axios.post.mockImplementation((url) => {
      expect(url).toMatch(/\/geoTargetConstants:suggest$/);
      expect(url).not.toMatch(/\/customers\/[^/]+\/geoTargetConstants:suggest$/);
      return Promise.resolve({
        status: 200,
        data: {
          geoTargetConstantSuggestions: [
            {
              geoTargetConstant: {
                resourceName: 'geoTargetConstants/2840',
                name: 'United States',
                canonicalName: 'United States',
                targetType: 'Country',
                countryCode: 'US',
                status: 'ENABLED',
              },
            },
          ],
        },
      });
    });

    await resolvePrimaryGeoTargetConstant({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '7809414862',
      label: 'United States',
    });
  });

  it('retries alternative US labels on 404 when label is already United States', async () => {
    process.env.GOOGLE_ADS_API_MOCK = 'false';
    process.env.GOOGLE_ADS_API_ENABLED = 'true';

    axios.post.mockImplementation((_url, body) => {
      const label = body?.locationNames?.names?.[0];

      if (label === 'United States') {
        return Promise.resolve({ status: 404, data: {} });
      }

      if (label === 'United States of America') {
        return Promise.resolve({
          status: 200,
          data: {
            geoTargetConstantSuggestions: [
              {
                geoTargetConstant: {
                  resourceName: 'geoTargetConstants/2840',
                  name: 'United States',
                  canonicalName: 'United States',
                  targetType: 'Country',
                  countryCode: 'US',
                  status: 'ENABLED',
                },
              },
            ],
          },
        });
      }

      return Promise.resolve({ status: 404, data: {} });
    });

    const out = await resolvePrimaryGeoTargetConstant({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '7809414862',
      label: 'United States',
    });

    expect(out.resourceName).toBe('geoTargetConstants/2840');
    expect(out.label).toBe('United States');
    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});
