'use strict';

const { trace, context, metrics } = require('@opentelemetry/api');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME } = require('@opentelemetry/semantic-conventions');

/** @type {NodeSDK | null} */
let sdk = null;
/** @type {import('@opentelemetry/api').Counter | null} */
let googleAdsRateLimitCounter = null;

/**
 * @returns {Record<string, string>}
 */
function buildOtelHeaders() {
  const headers = {};
  const rawHeaders = process.env.OTEL_EXPORTER_OTLP_HEADERS?.trim();
  if (rawHeaders) {
    for (const part of rawHeaders.split(',')) {
      const [key, ...rest] = part.split('=');
      const value = rest.join('=').trim();
      if (key?.trim() && value) {
        headers[key.trim()] = value;
      }
    }
  }
  if (!headers['x-honeycomb-team'] && process.env.HONEYCOMB_API_KEY?.trim()) {
    headers['x-honeycomb-team'] = process.env.HONEYCOMB_API_KEY.trim();
  }
  return headers;
}

/**
 * @param {string} baseEndpoint
 * @param {string} suffix
 */
function buildOtlpUrl(baseEndpoint, suffix) {
  const trimmed = baseEndpoint.replace(/\/$/, '');
  if (trimmed.endsWith(suffix)) return trimmed;
  return `${trimmed}${suffix}`;
}

/**
 * Bootstrap OTel when OTEL_EXPORTER_OTLP_ENDPOINT is set; otherwise no-op.
 * @param {string} serviceName
 */
function initOtel(serviceName) {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) return null;
  if (sdk) return sdk;

  const headers = buildOtelHeaders();
  const traceExporter = new OTLPTraceExporter({
    url: buildOtlpUrl(endpoint, '/v1/traces'),
    headers,
  });
  const metricExporter = new OTLPMetricExporter({
    url: buildOtlpUrl(endpoint, '/v1/metrics'),
    headers,
  });
  const metricReader = new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 60_000,
  });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
    }),
    traceExporter,
    metricReader,
  });
  sdk.start();

  const meter = metrics.getMeter('zuggernaut');
  googleAdsRateLimitCounter = meter.createCounter('google_ads.rate_limit.hit', {
    description: 'Google Ads API HTTP 429 rate-limit responses',
  });

  return sdk;
}

/**
 * Express middleware — HTTP request span when OTel is enabled.
 */
function otelHttpMiddleware(req, res, next) {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()) {
    return next();
  }

  const tracer = trace.getTracer('zuggernaut-http');
  const span = tracer.startSpan(`HTTP ${req.method} ${req.path}`, {
    attributes: {
      'http.method': req.method,
      'http.route': req.path,
    },
  });

  if (req.requestId) {
    span.setAttribute('request.id', req.requestId);
  }

  const spanContext = trace.setSpan(context.active(), span);
  res.on('finish', () => {
    span.setAttribute('http.status_code', res.statusCode);
    if (res.statusCode >= 500) {
      span.setStatus({ code: 2, message: `HTTP ${res.statusCode}` });
    }
    span.end();
  });

  return context.with(spanContext, () => next());
}

function recordGoogleAdsRateLimitHit() {
  if (googleAdsRateLimitCounter) {
    googleAdsRateLimitCounter.add(1);
  }
}

/**
 * Tag setup failures for log drains / OTel-backed dashboards.
 * @param {{ setupRunId?: string, businessId?: string, stepName?: string, provider?: string, errorCode?: string }} fields
 */
function recordSetupFailure(fields = {}) {
  if (!process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()) return;
  const tracer = trace.getTracer('zuggernaut-setup');
  const span = tracer.startSpan('setup.failure');
  if (fields.setupRunId) span.setAttribute('setupRunId', fields.setupRunId);
  if (fields.businessId) span.setAttribute('businessId', fields.businessId);
  if (fields.stepName) span.setAttribute('stepName', fields.stepName);
  if (fields.provider) span.setAttribute('provider', fields.provider);
  if (fields.errorCode) span.setAttribute('errorCode', fields.errorCode);
  span.setStatus({ code: 2, message: fields.errorCode ?? 'setup_failed' });
  span.end();
}

module.exports = {
  initOtel,
  otelHttpMiddleware,
  recordGoogleAdsRateLimitHit,
  recordSetupFailure,
};
