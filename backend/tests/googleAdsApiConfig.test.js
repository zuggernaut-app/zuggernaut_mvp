'use strict';

const axios = require('axios');

jest.mock('axios');

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
  parseRetryAfterMs,
  googleAdsRateLimitWaitMs,
  googleAdsPost,
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
      fieldViolations: [],
      googleAdsErrors: [],
      requestId: null,
    });
  });

  it('parses GoogleAdsFailure field paths and BadRequest fieldViolations', () => {
    const parsed = parseGoogleAdsApiError(400, {
      error: {
        status: 'INVALID_ARGUMENT',
        message: 'Request contains an invalid argument.',
        details: [
          {
            '@type': 'type.googleapis.com/google.rpc.BadRequest',
            fieldViolations: [{ field: 'operations', description: 'Unknown name "create".' }],
          },
          {
            '@type': 'type.googleapis.com/google.ads.googleads.v24.errors.GoogleAdsFailure',
            requestId: 'req-123',
            errors: [
              {
                message: 'Required field was missing.',
                errorCode: { fieldError: 'REQUIRED' },
                location: {
                  fieldPathElements: [
                    { fieldName: 'operations' },
                    { fieldName: 'create', index: 0 },
                    { fieldName: 'contains_eu_political_advertising' },
                  ],
                },
              },
            ],
          },
        ],
      },
    });

    expect(parsed.fieldViolations).toEqual([
      { field: 'operations', description: 'Unknown name "create".' },
    ]);
    expect(parsed.googleAdsErrors).toEqual([
      {
        field: 'operations.create[0].contains_eu_political_advertising',
        message: 'Required field was missing.',
        errorCode: 'fieldError:REQUIRED',
      },
    ]);
    expect(parsed.requestId).toBe('req-123');
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

  it('includes specific field violation detail in GoogleAdsApiError message', () => {
    const err = createGoogleAdsApiErrorFromResponse(
      400,
      {
        error: {
          status: 'INVALID_ARGUMENT',
          message: 'Request contains an invalid argument.',
          details: [
            {
              '@type': 'type.googleapis.com/google.rpc.BadRequest',
              fieldViolations: [{ field: 'operations[0].create.name', description: 'Too long.' }],
            },
          ],
        },
      },
      'GOOGLE_ADS_MUTATE_FAILED',
      { label: 'Google Ads campaign mutate', action: 'campaign:mutate' }
    );

    expect(err.message).toContain('operations[0].create.name: Too long.');
    expect(err.details?.fieldViolations).toHaveLength(1);
  });

  describe('rate limit helpers', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      process.env.GOOGLE_ADS_RATE_LIMIT_MAX_ATTEMPTS = '3';
      process.env.GOOGLE_ADS_RATE_LIMIT_BASE_MS = '10';
      process.env.GOOGLE_ADS_RATE_LIMIT_MAX_WAIT_MS = '100';
    });

    it('parseRetryAfterMs parses seconds', () => {
      expect(parseRetryAfterMs('2')).toBe(2000);
    });

    it('googleAdsRateLimitWaitMs uses exponential backoff when Retry-After is absent', () => {
      jest.spyOn(Math, 'random').mockReturnValue(0);
      expect(googleAdsRateLimitWaitMs(0, undefined)).toBe(10);
      expect(googleAdsRateLimitWaitMs(1, undefined)).toBe(20);
      Math.random.mockRestore();
    });

    it('googleAdsPost retries confirmed 429 responses then succeeds', async () => {
      axios.post
        .mockResolvedValueOnce({ status: 429, headers: {}, data: {} })
        .mockResolvedValueOnce({ status: 200, data: { ok: true } });

      const res = await googleAdsPost('https://example.com', {}, {}, { operation: 'test' });

      expect(res.status).toBe(200);
      expect(axios.post).toHaveBeenCalledTimes(2);
    });

    it('googleAdsPost does not retry non-429 responses', async () => {
      axios.post.mockResolvedValue({
        status: 403,
        data: { error: { status: 'PERMISSION_DENIED', message: 'denied' } },
      });

      const res = await googleAdsPost('https://example.com', {}, {}, { operation: 'test' });

      expect(res.status).toBe(403);
      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('googleAdsPost throws GOOGLE_ADS_RATE_LIMITED after exhausting client retries', async () => {
      axios.post.mockResolvedValue({ status: 429, headers: {}, data: {} });

      await expect(
        googleAdsPost('https://example.com', {}, {}, { operation: 'test' })
      ).rejects.toMatchObject({ code: 'GOOGLE_ADS_RATE_LIMITED' });

      expect(axios.post).toHaveBeenCalledTimes(3);
    });
  });
});
