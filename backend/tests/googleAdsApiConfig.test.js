'use strict';

const {
  DEFAULT_GOOGLE_ADS_API_VERSION,
  getGoogleAdsApiVersion,
  getGoogleAdsRequestTimeoutMs,
  buildGoogleAdsApiUrl,
  normalizeCustomerId,
  redactCustomerId,
  getGoogleAdsDeveloperToken,
  buildGoogleAdsHeaders,
  parseGoogleAdsApiError,
  createGoogleAdsApiErrorFromResponse,
  GoogleAdsApiError,
} = require('../services/integrations/googleAdsApiConfig');

describe('googleAdsApiConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('defaults Google Ads API version to v24', () => {
    delete process.env.GOOGLE_ADS_API_VERSION;
    expect(getGoogleAdsApiVersion()).toBe('v24');
    expect(DEFAULT_GOOGLE_ADS_API_VERSION).toBe('v24');
  });

  it('respects GOOGLE_ADS_API_VERSION override', () => {
    process.env.GOOGLE_ADS_API_VERSION = ' v25 ';
    expect(getGoogleAdsApiVersion()).toBe('v25');
  });

  it('buildGoogleAdsApiUrl uses the configured version', () => {
    delete process.env.GOOGLE_ADS_API_VERSION;
    expect(buildGoogleAdsApiUrl('customers:listAccessibleCustomers')).toBe(
      'https://googleads.googleapis.com/v24/customers:listAccessibleCustomers'
    );
  });

  it('defaults request timeout to 30 seconds', () => {
    delete process.env.GOOGLE_ADS_REQUEST_TIMEOUT_MS;
    expect(getGoogleAdsRequestTimeoutMs()).toBe(30_000);
  });

  it('normalizes login customer IDs by stripping dashes', () => {
    expect(normalizeCustomerId('346-219-8684')).toBe('3462198684');
    expect(normalizeCustomerId('')).toBeNull();
  });

  it('redacts customer IDs for safe diagnostics', () => {
    expect(redactCustomerId('3462198684')).toBe('…8684');
    expect(redactCustomerId('12')).toBe('****');
  });

  it('requires developer token for API calls', () => {
    delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    expect(() => getGoogleAdsDeveloperToken()).toThrow(GoogleAdsApiError);
  });

  it('omits login-customer-id when includeLoginCustomerId is false', () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-token';
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = '346-219-8684';

    const headers = buildGoogleAdsHeaders('access-token', { includeLoginCustomerId: false });

    expect(headers['developer-token']).toBe('dev-token');
    expect(headers.Authorization).toBe('Bearer access-token');
    expect(headers['login-customer-id']).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('includes normalized login-customer-id by default', () => {
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'dev-token';
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = '346-219-8684';

    const headers = buildGoogleAdsHeaders('access-token');

    expect(headers['login-customer-id']).toBe('3462198684');
  });

  it('parses Google API errors and redacts customer IDs', () => {
    const parsed = parseGoogleAdsApiError(
      403,
      { error: { status: 'PERMISSION_DENIED', message: 'User not authorized.' } },
      { action: 'listAccessibleCustomers', customerIds: ['1234567890'] }
    );

    expect(parsed).toEqual({
      statusCode: 403,
      googleStatus: 'PERMISSION_DENIED',
      message: 'User not authorized.',
      action: 'listAccessibleCustomers',
      redactedCustomerIds: ['…7890'],
    });
  });

  it('creates GoogleAdsApiError with parsed details attached', () => {
    const err = createGoogleAdsApiErrorFromResponse(
      400,
      { error: { status: 'INVALID_ARGUMENT', message: 'Bad request.' } },
      'GOOGLE_ADS_LIST_CUSTOMERS_FAILED',
      { label: 'Google Ads listAccessibleCustomers', action: 'listAccessibleCustomers' }
    );

    expect(err).toBeInstanceOf(GoogleAdsApiError);
    expect(err.code).toBe('GOOGLE_ADS_LIST_CUSTOMERS_FAILED');
    expect(err.message).toContain('listAccessibleCustomers failed (400)');
    expect(err.details?.googleStatus).toBe('INVALID_ARGUMENT');
  });
});
