'use strict';

require('../models');

jest.mock('../services/integrations/googleAdsAccountClient', () => ({
  listAccessibleCustomers: jest.fn(),
}));

jest.mock('../services/integrations/googleTokenService', () => ({
  getFreshGoogleAccessToken: jest.fn().mockResolvedValue('fresh-token'),
}));

const { listAccessibleCustomers } = require('../services/integrations/googleAdsAccountClient');
const { getConnectionStatus } = require('../services/capabilities/integrationConnectionService');
const { runGoogleAdsDiagnostics } = require('../services/dev/googleAdsDiagnosticsService');

jest.mock('../services/capabilities/integrationConnectionService', () => {
  const actual = jest.requireActual('../services/capabilities/integrationConnectionService');
  return {
    ...actual,
    getConnectionStatus: jest.fn(),
  };
});

describe('googleAdsDiagnosticsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getConnectionStatus.mockReset();
    listAccessibleCustomers.mockReset();
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = '346-219-8684';
  });

  it('loads without circular dependency on integrationDiagnosticsService', () => {
    expect(() => {
      jest.isolateModules(() => {
        require('../models');
        require('../services/dev/googleAdsDiagnosticsService');
      });
    }).not.toThrow();

    const diagnostics = require('../services/dev/googleAdsDiagnosticsService');
    const integration = require('../services/dev/integrationDiagnosticsService');
    expect(typeof diagnostics.runGoogleAdsDiagnostics).toBe('function');
    expect(typeof integration.runProviderSmokeTest).toBe('function');
  });

  it('reports OAuth ready when only provisioning is required', async () => {
    getConnectionStatus
      .mockResolvedValueOnce({
        ready: false,
        reason: 'provisioning_required',
        connectionHealth: 'provisioning_required',
        scopesMissing: [],
        providerIdentifiers: { discoveryReason: 'ADS_PROVISIONING_REQUIRED' },
      })
      .mockResolvedValueOnce({
        ready: true,
        reason: 'ok',
        connectionHealth: 'connected',
        scopesMissing: [],
        providerIdentifiers: {
          customerId: '1234567890',
          accessibleCustomerIds: ['1234567890'],
        },
      });
    listAccessibleCustomers.mockResolvedValue(['1234567890']);

    const result = await runGoogleAdsDiagnostics('biz-1');
    const oauthTest = result.tests.find((test) => test.name === 'oauth_connection');

    expect(oauthTest.ok).toBe(true);
    expect(oauthTest.errorCode).toBeNull();
    expect(oauthTest.message).toContain('OAuth is ready');
    expect(oauthTest.details).toEqual(
      expect.objectContaining({
        identifiersReady: false,
        reason: 'provisioning_required',
      })
    );
  });

  it('reports OAuth failure when tokens are missing', async () => {
    getConnectionStatus.mockResolvedValue({
      ready: false,
      reason: 'missing_tokens',
      connectionHealth: 'not_connected',
      scopesMissing: [],
      providerIdentifiers: null,
    });

    const result = await runGoogleAdsDiagnostics('biz-2');
    const oauthTest = result.tests.find((test) => test.name === 'oauth_connection');

    expect(oauthTest.ok).toBe(false);
    expect(oauthTest.errorCode).toBe('MISSING_TOKENS');
    expect(oauthTest.message).toContain('OAuth not ready');
    expect(result.ok).toBe(false);
    expect(listAccessibleCustomers).not.toHaveBeenCalled();
  });

  it('does not auto-select customerId after listAccessibleCustomers', async () => {
    const IntegrationConnection = require('mongoose').model('IntegrationConnection');

    getConnectionStatus
      .mockResolvedValueOnce({
        ready: true,
        reason: 'ok',
        connectionHealth: 'connected',
        scopesMissing: [],
        providerIdentifiers: { customerId: '6314301557' },
      })
      .mockResolvedValueOnce({
        ready: false,
        reason: 'selection_required',
        connectionHealth: 'selection_required',
        scopesMissing: [],
        providerIdentifiers: {
          accessibleCustomerIds: ['7809414862', '6314301557'],
          selectionRequired: true,
        },
      });
    listAccessibleCustomers.mockResolvedValue(['7809414862', '6314301557']);

    const findOne = jest.spyOn(IntegrationConnection, 'findOne');
    findOne.mockReturnValue({
      select: () => ({
        lean: async () => ({
          providerIdentifiers: { customerId: '6314301557' },
        }),
      }),
    });

    const findOneAndUpdate = jest.spyOn(IntegrationConnection, 'findOneAndUpdate');
    findOneAndUpdate.mockResolvedValue({});

    const result = await runGoogleAdsDiagnostics('biz-3');

    expect(result.ok).toBe(true);
    expect(result.message).toContain('Select a Google Ads customer account');
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { businessId: 'biz-3', provider: 'google_ads' },
      expect.objectContaining({
        $set: expect.objectContaining({
          connectionHealth: 'selection_required',
          providerIdentifiers: expect.objectContaining({
            accessibleCustomerIds: ['7809414862', '6314301557'],
            selectionRequired: true,
          }),
        }),
      }),
    );
    const updatePayload = findOneAndUpdate.mock.calls[0][1];
    expect(updatePayload.$set.providerIdentifiers.customerId).toBeUndefined();

    findOne.mockRestore();
    findOneAndUpdate.mockRestore();
  });
});
