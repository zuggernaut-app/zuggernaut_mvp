'use strict';

const axios = require('axios');
const {
  listAccessibleCustomers,
  createCustomerClient,
  buildGoogleAdsHeaders,
  pickBestLinkFromRows,
  getCustomerClientLinkStatus,
  getCustomerManagerLinkStatus,
  resolveMccLinkStatus,
  isMccLinkActive,
} = require('../services/integrations/googleAdsAccountClient');
const { resetProviderRateLimitsForTests } = require('../lib/providerRateLimit');

jest.mock('axios');

describe('googleAdsAccountClient', () => {
  beforeEach(() => {
    resetProviderRateLimitsForTests();
    jest.clearAllMocks();
    process.env.GOOGLE_ADS_API_MOCK = 'false';
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'test-dev-token';
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = '346-219-8684';
  });

  afterEach(() => {
    process.env.GOOGLE_ADS_API_MOCK = 'true';
  });

  it('listAccessibleCustomers omits login-customer-id header', async () => {
    axios.get.mockResolvedValue({
      status: 200,
      data: { resourceNames: ['customers/1234567890'] },
    });

    await listAccessibleCustomers('token');

    const [url, config] = axios.get.mock.calls[0];
    expect(config.headers['login-customer-id']).toBeUndefined();
    expect(config.headers['developer-token']).toBe('test-dev-token');
    expect(url).toContain('/v24/customers:listAccessibleCustomers');
  });

  it('createCustomerClient includes login-customer-id header', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { resourceName: 'customers/5555555555' },
    });

    await createCustomerClient('token', '3462198684', { descriptiveName: 'Acme Ads' });

    const [url, body, config] = axios.post.mock.calls[0];
    expect(config.headers['login-customer-id']).toBe('3462198684');
    expect(url).toContain('/v24/customers/3462198684:createCustomerClient');
    expect(body.customerClient.testAccount).toBeUndefined();
  });

  it('createCustomerClient sends testAccount when requested', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: { resourceName: 'customers/5555555555' },
    });

    await createCustomerClient('token', '3462198684', {
      descriptiveName: 'Test Client',
      testAccount: true,
    });

    const [, body] = axios.post.mock.calls[0];
    expect(body.customerClient.testAccount).toBe(true);
  });

  it('parses Google API errors with actionable details', async () => {
    axios.get.mockResolvedValue({
      status: 403,
      data: { error: { status: 'PERMISSION_DENIED', message: 'The caller does not have permission.' } },
    });

    await expect(listAccessibleCustomers('token')).rejects.toMatchObject({
      code: 'GOOGLE_ADS_LIST_CUSTOMERS_FAILED',
      details: expect.objectContaining({
        statusCode: 403,
        googleStatus: 'PERMISSION_DENIED',
        action: 'listAccessibleCustomers',
      }),
    });
  });

  it('buildGoogleAdsHeaders documents login-customer-id inclusion for MCC calls', () => {
    const mccHeaders = buildGoogleAdsHeaders('token', { loginCustomerId: '3462198684' });
    const listHeaders = buildGoogleAdsHeaders('token', { includeLoginCustomerId: false, includeContentType: false });

    expect(mccHeaders['login-customer-id']).toBe('3462198684');
    expect(listHeaders['login-customer-id']).toBeUndefined();
  });

  it('pickBestLinkFromRows prefers PENDING over INACTIVE', () => {
    const rows = [
      {
        customerClientLink: {
          status: 'INACTIVE',
          managerLinkId: '111',
          resourceName: 'customers/2940178860/customerClientLinks/111',
        },
      },
      {
        customerClientLink: {
          status: 'PENDING',
          managerLinkId: '222',
          resourceName: 'customers/2940178860/customerClientLinks/222',
        },
      },
    ];

    const best = pickBestLinkFromRows(rows, 'customerClientLink');
    expect(best?.status).toBe('PENDING');
    expect(best?.managerLinkId).toBe('222');
  });

  it('getCustomerClientLinkStatus returns the highest-priority link row', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        results: [
          {
            customerClientLink: {
              status: 'INACTIVE',
              managerLinkId: '886161240',
              resourceName: 'customers/2940178860/customerClientLinks/886161240',
              clientCustomer: 'customers/7809414862',
            },
          },
          {
            customerClientLink: {
              status: 'PENDING',
              managerLinkId: '886161241',
              resourceName: 'customers/2940178860/customerClientLinks/886161241',
              clientCustomer: 'customers/7809414862',
            },
          },
        ],
      },
    });

    const status = await getCustomerClientLinkStatus('token', '2940178860', '7809414862');
    expect(status.status).toBe('PENDING');
    expect(status.managerLinkId).toBe('886161241');
  });

  it('isMccLinkActive returns true when either view is ACTIVE', () => {
    expect(
      isMccLinkActive({
        managerView: { status: 'PENDING' },
        clientView: { status: 'ACTIVE' },
      }),
    ).toBe(true);
    expect(
      isMccLinkActive({
        managerView: { status: 'PENDING' },
        clientView: { status: 'PENDING' },
      }),
    ).toBe(false);
  });

  it('resolveMccLinkStatus prefers client-side PENDING when manager view is INACTIVE', async () => {
    axios.post.mockImplementation(async (_url, body) => {
      if (body.query.includes('customer_client_link')) {
        return {
          status: 200,
          data: {
            results: [
              {
                customerClientLink: {
                  status: 'INACTIVE',
                  managerLinkId: '886161240',
                  resourceName: 'customers/2940178860/customerClientLinks/886161240',
                  clientCustomer: 'customers/7809414862',
                },
              },
            ],
          },
        };
      }

      return {
        status: 200,
        data: {
          results: [
            {
              customerManagerLink: {
                status: 'PENDING',
                managerLinkId: '886161241',
                resourceName: 'customers/7809414862/customerManagerLinks/2940178860~886161241',
                managerCustomer: 'customers/2940178860',
              },
            },
          ],
        },
      };
    });

    const resolved = await resolveMccLinkStatus('token', '2940178860', '7809414862');
    expect(resolved.pending?.status).toBe('PENDING');
    expect(resolved.pending?.source).toBe('client');
    expect(resolved.linkStatus.managerLinkId).toBe('886161241');
    expect(resolved.linkReady).toBe(false);
  });

  it('getCustomerManagerLinkStatus queries customer_manager_link from the client account', async () => {
    axios.post.mockResolvedValue({
      status: 200,
      data: {
        results: [
          {
            customerManagerLink: {
              status: 'PENDING',
              managerLinkId: '42',
              resourceName: 'customers/7809414862/customerManagerLinks/2940178860~42',
              managerCustomer: 'customers/2940178860',
            },
          },
        ],
      },
    });

    const status = await getCustomerManagerLinkStatus('token', '7809414862', '2940178860');
    expect(status.status).toBe('PENDING');
    expect(status.managerLinkId).toBe('42');

    const [url, body, config] = axios.post.mock.calls[0];
    expect(url).toContain('/customers/7809414862/googleAds:search');
    expect(body.query).toContain('customer_manager_link');
    expect(body.query).toContain("customers/2940178860");
    expect(config.headers['login-customer-id']).toBe('7809414862');
  });
});
