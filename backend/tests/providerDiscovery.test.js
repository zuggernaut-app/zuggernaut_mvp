'use strict';

const mongoose = require('mongoose');
const axios = require('axios');
const { discoverGtmProviderIdentifiers } = require('../services/integrations/googleTagManagerClient');
const { discoverGoogleAdsProviderIdentifiers } = require('../services/integrations/googleAdsAccountClient');
const { discoverGbpProviderIdentifiers } = require('../services/integrations/gbpProfileReadClient');
const { discoverProviderConnection } = require('../services/integrations/providerDiscoveryService');
const {
  buildSelectionRequiredResult,
  defaultSelectionReason,
  mergeRediscoveryWithSavedSelection,
} = require('../services/integrations/providerDiscoveryResult');
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
    it('requires explicit GTM selection when hierarchy exists', async () => {
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

      expect(result.connectionHealth).toBe('selection_required');
      expect(result.reason).toBe('GTM_RESOURCE_SELECTION_REQUIRED');
      expect(result.providerIdentifiers.discoveredAccountCount).toBe(1);
      expect(result.providerIdentifiers.discoveredContainerCount).toBe(1);
      expect(result.providerIdentifiers.discoveredWorkspaceCount).toBe(1);
      expect(result.providerIdentifiers.accountId).toBeUndefined();
    });

    it('returns gtm_account_not_found when no GTM accounts exist', async () => {
      axios.get.mockResolvedValue({ status: 200, data: { account: [] } });

      const result = await discoverGtmProviderIdentifiers('token');

      expect(result.connectionHealth).toBe('provisioning_required');
      expect(result.reason).toBe('GTM_ACCOUNT_NOT_FOUND');
    });
  });

  describe('Google Ads', () => {
    it('listAccessibleCustomers omits login-customer-id header', async () => {
      process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = '346-219-8684';
      axios.get.mockResolvedValue({
        status: 200,
        data: { resourceNames: ['customers/1234567890'] },
      });

      await discoverGoogleAdsProviderIdentifiers('token');

      expect(axios.get).toHaveBeenCalled();
      const [, config] = axios.get.mock.calls[0];
      expect(config.headers['login-customer-id']).toBeUndefined();
      expect(config.headers['developer-token']).toBe('test-dev-token');
    });

    it('requires explicit customer selection when accessible customers exist', async () => {
      axios.get.mockResolvedValue({
        status: 200,
        data: { resourceNames: ['customers/1234567890', 'customers/9876543210'] },
      });

      const result = await discoverGoogleAdsProviderIdentifiers('token');

      expect(result.connectionHealth).toBe('selection_required');
      expect(result.reason).toBe('ADS_CUSTOMER_SELECTION_REQUIRED');
      expect(result.providerIdentifiers.customerId).toBeUndefined();
      expect(result.providerIdentifiers.accessibleCustomerIds).toEqual(['1234567890', '9876543210']);
    });

    it('returns ADS_CUSTOMER_NOT_FOUND when no accessible customers', async () => {
      axios.get.mockResolvedValue({ status: 200, data: { resourceNames: [] } });

      const result = await discoverGoogleAdsProviderIdentifiers('token');

      expect(result.connectionHealth).toBe('provisioning_required');
      expect(result.reason).toBe('ADS_CUSTOMER_NOT_FOUND');
      expect(result.providerIdentifiers.discoveryReason).toBe('ADS_CUSTOMER_NOT_FOUND');
    });

    it('surfaces structured Google API errors on discovery failure', async () => {
      axios.get.mockResolvedValue({
        status: 403,
        data: { error: { status: 'PERMISSION_DENIED', message: 'Developer token is not allowed.' } },
      });

      const result = await discoverGoogleAdsProviderIdentifiers('token');

      expect(result.connectionHealth).toBe('provisioning_required');
      expect(result.providerIdentifiers.discoveryError).toBe('GOOGLE_ADS_LIST_CUSTOMERS_FAILED');
      expect(result.providerIdentifiers.googleErrorSummary).toEqual(
        expect.objectContaining({
          statusCode: 403,
          googleStatus: 'PERMISSION_DENIED',
          action: 'listAccessibleCustomers',
        })
      );
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
      expect(row.providerIdentifiers.discoveryReason).toBe('GTM_ACCOUNT_NOT_FOUND');
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

  describe('mergeRediscoveryWithSavedSelection', () => {
    it('preserves saved Google Ads customerId when rediscovery still requires selection', () => {
      const discovery = buildSelectionRequiredResult(
        'google_ads',
        {
          accessibleCustomerIds: ['1234567890', '7809414862'],
          loginCustomerId: '2940178860',
        },
        defaultSelectionReason('google_ads')
      );
      const prior = {
        customerId: '7809414862',
        selectionRequired: false,
        selectedAt: '2026-06-10T12:00:00.000Z',
        selectionSource: 'product_setup',
      };

      const merged = mergeRediscoveryWithSavedSelection('google_ads', prior, discovery);

      expect(merged.connectionHealth).toBe('connected');
      expect(merged.providerIdentifiers.customerId).toBe('7809414862');
      expect(merged.providerIdentifiers.selectionRequired).toBe(false);
      expect(merged.providerIdentifiers.accessibleCustomerIds).toEqual(['1234567890', '7809414862']);
    });

    it('preserves saved Google Ads mccLink when rediscovery merges saved selection', () => {
      const discovery = buildSelectionRequiredResult(
        'google_ads',
        {
          accessibleCustomerIds: ['8383537213'],
          loginCustomerId: '2940178860',
        },
        defaultSelectionReason('google_ads')
      );
      const mccLink = {
        status: 'ACTIVE',
        managerCustomerId: '2940178860',
        clientCustomerId: '8383537213',
        checkedAt: '2026-06-10T12:00:00.000Z',
        acceptedAt: '2026-06-10T12:00:00.000Z',
      };
      const prior = {
        customerId: '8383537213',
        loginCustomerId: '2940178860',
        selectionRequired: false,
        mccLink,
      };

      const merged = mergeRediscoveryWithSavedSelection('google_ads', prior, discovery);

      expect(merged.providerIdentifiers.mccLink).toEqual(mccLink);
    });

    it('does not preserve Google Ads selection when customer is no longer accessible', () => {
      const discovery = buildSelectionRequiredResult(
        'google_ads',
        { accessibleCustomerIds: ['1234567890'] },
        defaultSelectionReason('google_ads')
      );
      const prior = {
        customerId: '7809414862',
        selectionRequired: false,
      };

      const merged = mergeRediscoveryWithSavedSelection('google_ads', prior, discovery);

      expect(merged.connectionHealth).toBe('selection_required');
      expect(merged.providerIdentifiers.customerId).toBeUndefined();
    });

    it('preserves saved GTM hierarchy when rediscovery still requires selection', () => {
      const discovery = buildSelectionRequiredResult(
        'gtm',
        {
          discoveredAccountCount: 1,
          discoveredContainerCount: 1,
          discoveredWorkspaceCount: 1,
        },
        defaultSelectionReason('gtm')
      );
      const prior = {
        accountId: 'acc-1',
        containerId: 'ctr-1',
        workspaceId: 'ws-1',
        publicContainerId: 'GTM-ABC',
        selectionRequired: false,
        selectedAt: '2026-06-10T12:00:00.000Z',
      };

      const merged = mergeRediscoveryWithSavedSelection('gtm', prior, discovery);

      expect(merged.connectionHealth).toBe('connected');
      expect(merged.providerIdentifiers.accountId).toBe('acc-1');
      expect(merged.providerIdentifiers.containerId).toBe('ctr-1');
      expect(merged.providerIdentifiers.workspaceId).toBe('ws-1');
    });
  });

  describe('mock OAuth discovery path', () => {
    it('returns connected GTM identifiers under GOOGLE_OAUTH_MOCK', async () => {
      process.env.GOOGLE_OAUTH_MOCK = 'true';

      const result = await discoverProviderConnection('gtm', 'mock-token');

      expect(result.connectionHealth).toBe('selection_required');
      expect(result.reason).toBe('GTM_RESOURCE_SELECTION_REQUIRED');
      expect(result.providerIdentifiers.accountId).toBeUndefined();
    });
  });
});
