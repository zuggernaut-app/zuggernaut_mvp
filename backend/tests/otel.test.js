'use strict';

const { otelHttpMiddleware, initOtel, recordGoogleAdsRateLimitHit } = require('../lib/observability/otel');

describe('otel', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('otelHttpMiddleware is a no-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset', () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    const next = jest.fn();
    const req = { method: 'GET', path: '/api/v1/health' };
    const res = { on: jest.fn(), statusCode: 200 };
    otelHttpMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('initOtel returns null when endpoint unset', () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    expect(initOtel('test-service')).toBeNull();
  });

  it('recordGoogleAdsRateLimitHit is safe without init', () => {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
    expect(() => recordGoogleAdsRateLimitHit()).not.toThrow();
  });
});
