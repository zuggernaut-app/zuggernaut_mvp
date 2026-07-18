'use strict';

// TEMPORARY: smoke tests for `resolvePrimaryGeoTargetConstant` geo suggest behavior.
// Delete after the real geo end-to-end path is fixed.

const axios = require('axios');

jest.mock('axios');
jest.mock('../services/integrations/googleTokenService', () => ({
  getFreshGoogleAccessToken: jest.fn().mockResolvedValue('test-access-token'),
}));

const {
  resolvePrimaryGeoTargetConstant,
} = require('../services/integrations/googleAdsGeoTargetClient');

describe('googleAdsGeoTargetClient smoke (geo suggest fallback/404)', () => {
  const prevMock = process.env.GOOGLE_ADS_API_MOCK;
  const prevEnabled = process.env.GOOGLE_ADS_API_ENABLED;
  const prevToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

  beforeEach(() => {
    process.env.GOOGLE_ADS_API_MOCK = 'false';
    process.env.GOOGLE_ADS_API_ENABLED = 'true';
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env.GOOGLE_ADS_API_MOCK = prevMock;
    process.env.GOOGLE_ADS_API_ENABLED = prevEnabled;
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = prevToken;
  });

  it('retries alternative US labels on 404 when label is already "United States"', async () => {
    axios.post.mockImplementation((url, body) => {
      expect(url).toMatch(/\/geoTargetConstants:suggest$/);
      expect(url).not.toMatch(/\/customers\/[^/]+\/geoTargetConstants:suggest$/);

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
                searchTerm: 'United States of America',
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

  it('falls back on 404 for a non-fallback label and can succeed', async () => {
    axios.post.mockImplementation((url, body) => {
      expect(url).toMatch(/\/geoTargetConstants:suggest$/);
      expect(url).not.toMatch(/\/customers\/[^/]+\/geoTargetConstants:suggest$/);

      const label = body?.locationNames?.names?.[0];

      if (label === 'medhahari.in area') {
        return Promise.resolve({ status: 404, data: {} });
      }

      if (label === 'United States') {
        return Promise.resolve({
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
      }

      return Promise.resolve({ status: 404, data: {} });
    });

    const out = await resolvePrimaryGeoTargetConstant({
      businessId: '507f1f77bcf86cd799439011',
      customerId: '7809414862',
      label: 'medhahari.in area',
    });

    expect(out.resourceName).toBe('geoTargetConstants/2840');
    expect(out.label).toBe('medhahari.in area');
    expect(axios.post).toHaveBeenCalledTimes(2);
  });
});
