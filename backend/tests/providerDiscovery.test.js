'use strict';

const mongoose = require('mongoose');
const axios = require('axios');
const { discoverGtmProviderIdentifiers } = require('../services/integrations/googleTagManagerClient');
const { discoverGoogleAdsProviderIdentifiers } = require('../services/integrations/googleAdsAccountClient');
const { discoverGbpProviderIdentifiers } = require('../services/integrations/gbpProfileReadClient');
const { discoverProviderConnection } = require('../services/integrations/providerDiscoveryService');
const { completeGoogleOAuthCallback } = require('../services/integrations/googleOAuthService');
const { resetProviderRateLimitsForTests } = require('../lib/providerRateLimit');

jest.mock('axios');

describe('provider discovery', () => {
  beforeEach(() => {
    resetProviderRateLimitsForTests();
    jest.clearAllMocks();
    delete process.env.GOOGLE_OAUTH_MOCK;
    process.env.GTM_API_MOCK = 'false';
    process.env.GOOGLE_ADS_API_MOCK = 'false';
    process.env.GBP_API_MOCK = 'false';
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
  });

  afterEach(() => {
    process.env.GOOGLE_OAUTH_MOCK = 'true';
    process.env.GTM_API_MOCK = 'true';
    process.env.GOOGLE_ADS_API_MOCK = 'true';
    process.env.GBP_API_MOCK = 'true';
  });

  describe('GTM', () => {
    it('discovers account/container/workspace and marks connected', async () => {
      axios.get.mockImplementation((url) => {
        if (url.endsWith('/accounts')) {
          return Promise.resolve({ status: 200, data: { account: [{ accountId: '100', name: 'Main' }] } });
        }
        if (url.includes('/containers') && url.includes('/workspaces')) {
          return Promise.resolve({
            status: 200,
            data: { workspace: [{ workspaceId: '3', name: 'Default' }] },
          });
        }
        if (url.includes('/containers')) {
          return Promise.resolve({
            status: 200,
            data: {
              container: [{ containerId: '200', publicId: 'GTM-ABC', usageContext: ['web'] }],
            },
          });
        }
        return Promise.resolve({ status: 404, data: {} });
      });

      const result = await discoverGtmProviderIdentifiers('token');

      expect(result.connectionHealth).toBe('connected');
      expect(result.reason).toBeNull();
      expect(result.providerIdentifiers).toEqual({
        accountId: '100',
        containerId: '200',
        workspaceId: '3',
        publicContainerId: 'GTM-ABC',
      });
    });

    it('returns provisioning_required when no GTM hierarchy exists', async () => {
      axios.get.mockResolvedValue({ status: 200, data: { account: [] } });

      const result = await discoverGtmProviderIdentifiers('token');

      expect(result.connectionHealth).toBe('provisioning_required');
      expect(result.reason).toBe('GTM_PROVISIONING_REQUIRED');
    });
  });

  describe('Google Ads', () => {
    it('persists customerId when accessible customers exist', async () => {
      axios.get.mockResolvedValue({
        status: 200,
        data: { resourceNames: ['customers/1234567890', 'customers/9876543210'] },
      });

      const result = await discoverGoogleAdsProviderIdentifiers('token');

      expect(result.connectionHealth).toBe('connected');
      expect(result.providerIdentifiers.customerId).toBe('1234567890');
      expect(result.providerIdentifiers.accessibleCustomerIds).toEqual(['1234567890', '9876543210']);
    });

    it('returns provisioning_required when no accessible customers', async () => {
      axios.get.mockResolvedValue({ status: 200, data: { resourceNames: [] } });

      const result = await discoverGoogleAdsProviderIdentifiers('token');

      expect(result.connectionHealth).toBe('provisioning_required');
      expect(result.reason).toBe('ADS_PROVISIONING_REQUIRED');
    });
  });

  describe('GBP', () => {
    it('discovers account and location while staying connected', async () => {
      axios.get.mockImplementation((url) => {
        if (url.includes('mybusinessaccountmanagement')) {
          return Promise.resolve({ status: 200, data: { accounts: [{ name: 'accounts/111' }] } });
        }
        if (url.includes('/locations')) {
          return Promise.resolve({
            status: 200,
            data: { locations: [{ name: 'accounts/111/locations/222', title: 'Acme' }] },
          });
        }
        return Promise.resolve({ status: 404, data: {} });
      });

      const result = await discoverGbpProviderIdentifiers('token');

      expect(result.connectionHealth).toBe('connected');
      expect(result.reason).toBeNull();
      expect(result.providerIdentifiers.accountName).toBe('accounts/111');
      expect(result.providerIdentifiers.locationName).toBe('accounts/111/locations/222');
    });

    it('returns GBP_NO_ACCOUNTS guidance without blocking connection', async () => {
      axios.get.mockResolvedValue({ status: 200, data: { accounts: [] } });

      const result = await discoverGbpProviderIdentifiers('token');

      expect(result.connectionHealth).toBe('connected');
      expect(result.reason).toBe('GBP_NO_ACCOUNTS');
    });

    it('returns GBP_NO_LOCATIONS when accounts exist but no locations', async () => {
      axios.get.mockImplementation((url) => {
        if (url.includes('mybusinessaccountmanagement')) {
          return Promise.resolve({ status: 200, data: { accounts: [{ name: 'accounts/111' }] } });
        }
        return Promise.resolve({ status: 200, data: { locations: [] } });
      });

      const result = await discoverGbpProviderIdentifiers('token');

      expect(result.connectionHealth).toBe('connected');
      expect(result.reason).toBe('GBP_NO_LOCATIONS');
    });
  });

  describe('OAuth callback integration', () => {
    async function createBusiness() {
      const User = mongoose.model('User');
      const BusinessContext = mongoose.model('BusinessContext');
      const user = await User.create({ email: `disc-${Date.now()}@test.com` });
      const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
      return { user, businessId: bc.businessId };
    }

    it('persists provisioning_required for GTM when discovery finds nothing', async () => {
      delete process.env.GOOGLE_OAUTH_MOCK;
      process.env.GTM_API_MOCK = 'false';

      axios.post.mockResolvedValue({
        status: 200,
        data: {
          access_token: 'real-access',
          refresh_token: 'real-refresh',
          expires_in: 3600,
          scope: require('../constants/googleOAuth').allScopesForProvider('gtm').join(' '),
        },
      });
      axios.get.mockResolvedValue({ status: 200, data: { account: [] } });

      const { businessId, user } = await createBusiness();

      await completeGoogleOAuthCallback({
        businessId: businessId.toString(),
        provider: 'gtm',
        userId: user._id.toString(),
        code: 'auth-code',
      });

      const row = await mongoose.model('IntegrationConnection').findOne({ businessId, provider: 'gtm' }).lean();
      expect(row.connectionHealth).toBe('provisioning_required');
      expect(row.providerIdentifiers.discoveryReason).toBe('GTM_PROVISIONING_REQUIRED');
    });

    it('does not create IntegrationArtifact or IntegrationProvisioningRequest on OAuth callback', async () => {
      process.env.GOOGLE_OAUTH_MOCK = 'true';
      const { businessId, user } = await createBusiness();

      await completeGoogleOAuthCallback({
        businessId: businessId.toString(),
        provider: 'google_ads',
        userId: user._id.toString(),
        code: 'mock-auth-code',
      });

      const artifactCount = await mongoose.model('IntegrationArtifact').countDocuments({ businessId });
      const provisioningCount = await mongoose
        .model('IntegrationProvisioningRequest')
        .countDocuments({ businessId });

      expect(artifactCount).toBe(0);
      expect(provisioningCount).toBe(0);
    });
  });

  describe('mock OAuth discovery path', () => {
    it('returns connected GTM identifiers under GOOGLE_OAUTH_MOCK', async () => {
      process.env.GOOGLE_OAUTH_MOCK = 'true';

      const result = await discoverProviderConnection('gtm', 'mock-token');

      expect(result.connectionHealth).toBe('connected');
      expect(result.providerIdentifiers.accountId).toBe('mock-account');
      expect(result.providerIdentifiers.workspaceId).toBe('mock-workspace');
    });
  });
});
