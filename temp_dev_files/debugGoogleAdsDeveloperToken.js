/**
 * Minimal check: is the Google Ads *developer token* the blocker?
 *
 * Calls only customers:listAccessibleCustomers (read, no login-customer-id).
 * Parses authorizationError so you can tell token vs OAuth/user issues apart.
 *
 * Isolated from Jest. No Temporal, no discovery stack, no writes.
 *
 * Mode A — paste a fresh access token:
 *   set GOOGLE_ADS_DEVELOPER_TOKEN=your_token
 *   set GOOGLE_ADS_ACCESS_TOKEN=ya29...
 *   node scripts/debugGoogleAdsDeveloperToken.js
 *
 * Mode B — use Mongo OAuth for a business (same as Dev Integrations):
 *   node scripts/debugGoogleAdsDeveloperToken.js <businessId>
 *
 * Compare tokens: change only GOOGLE_ADS_DEVELOPER_TOKEN in .env, re-run.
 * If error changes from DEVELOPER_TOKEN_NOT_APPROVED → success, the token was the limit.
 */
'use strict';

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const axios = require('axios');
const mongoose = require('mongoose');
require('../models');
const { getFreshGoogleAccessToken } = require('../services/integrations/googleTokenService');
const {
  getGoogleAdsApiVersion,
  getGoogleAdsRequestTimeoutMs,
  normalizeCustomerId,
} = require('../services/integrations/googleAdsApiConfig');

const PROVIDER = 'google_ads';
const ORIGIN = process.env.GOOGLE_ADS_API_ORIGIN?.trim() || 'https://googleads.googleapis.com';
const uri =
  process.env.MONGODB_URI ||
  process.env.mongodb_uri ||
  'mongodb://localhost:27017/zuggernaut';

function usage() {
  console.error('Usage:');
  console.error('  GOOGLE_ADS_DEVELOPER_TOKEN=... GOOGLE_ADS_ACCESS_TOKEN=... node scripts/debugGoogleAdsDeveloperToken.js');
  console.error('  node scripts/debugGoogleAdsDeveloperToken.js <businessId>');
  process.exit(1);
}

function redact(value) {
  if (!value || typeof value !== 'string') return '(missing)';
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function developerTokenFingerprint(token) {
  if (!token) return { present: false, length: 0, fingerprint: '(missing)' };
  return {
    present: true,
    length: token.length,
    fingerprint: redact(token),
  };
}

function parseAuthorizationError(body) {
  const details = Array.isArray(body?.error?.details) ? body.error.details : [];
  const failure = details.find((row) =>
    String(row['@type'] ?? '').includes('GoogleAdsFailure'),
  );
  const first = failure?.errors?.[0];
  return {
    googleStatus: body?.error?.status ?? null,
    message: body?.error?.message ?? null,
    authorizationError: first?.errorCode?.authorizationError ?? null,
    detailMessage: first?.message ?? null,
    requestId: failure?.requestId ?? null,
  };
}

function interpret(authorizationError) {
  if (!authorizationError) {
    return 'No Google Ads authorizationError in response (check HTTP status and body).';
  }
  if (authorizationError === 'DEVELOPER_TOKEN_NOT_APPROVED') {
    return 'Developer token is the limiting factor (Test-only token hitting non-test context, or wrong token).';
  }
  if (authorizationError === 'DEVELOPER_TOKEN_PROHIBITED') {
    return 'Developer token is invalid or prohibited.';
  }
  if (authorizationError === 'USER_PERMISSION_DENIED') {
    return 'Developer token accepted; OAuth user lacks API access to list customers (wrong Google account or no Ads access).';
  }
  if (authorizationError === 'CUSTOMER_NOT_ENABLED') {
    return 'Developer token likely OK; target customer context is disabled (not applicable to listAccessibleCustomers).';
  }
  return `See authorizationError: ${authorizationError}`;
}

async function resolveAccessToken(businessId) {
  const fromEnv = process.env.GOOGLE_ADS_ACCESS_TOKEN?.trim();
  if (fromEnv) {
    return { accessToken: fromEnv, source: 'GOOGLE_ADS_ACCESS_TOKEN env' };
  }

  if (!businessId) {
    usage();
  }

  await mongoose.connect(uri);
  const accessToken = await getFreshGoogleAccessToken({ businessId, provider: PROVIDER });
  return { accessToken, source: `Mongo IntegrationConnection (${businessId})` };
}

async function listAccessibleCustomers(accessToken, developerToken) {
  const apiVersion = getGoogleAdsApiVersion();
  const url = `${ORIGIN}/${apiVersion}/customers:listAccessibleCustomers`;
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
  };

  const res = await axios.get(url, {
    headers,
    timeout: getGoogleAdsRequestTimeoutMs(),
    validateStatus: () => true,
  });

  return { url, apiVersion, headers, res };
}

async function main() {
  const businessId = process.argv[2]?.trim() || null;
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim();

  if (!developerToken) {
    throw new Error('GOOGLE_ADS_DEVELOPER_TOKEN is required in backend/.env');
  }

  const tokenInfo = developerTokenFingerprint(developerToken);

  console.log('Google Ads developer token isolation check');
  console.log('API version:', getGoogleAdsApiVersion());
  console.log('Developer token loaded:', tokenInfo.fingerprint, `(length ${tokenInfo.length})`);
  console.log('Endpoint: customers:listAccessibleCustomers (no login-customer-id)');
  console.log('');

  let accessSource = null;
  try {
    const { accessToken, source } = await resolveAccessToken(businessId);
    accessSource = source;
    console.log('OAuth access token source:', source);
    console.log('OAuth access token:', redact(accessToken));
    console.log('');

    const { url, apiVersion, headers, res } = await listAccessibleCustomers(
      accessToken,
      developerToken,
    );

    console.log('Request URL:', url);
    console.log('Headers sent:', {
      Authorization: `Bearer ${redact(accessToken)}`,
      'developer-token': redact(headers['developer-token']),
      'login-customer-id': '(not sent — correct for this endpoint)',
    });
    console.log('');
    console.log('HTTP status:', res.status);

    if (res.status >= 200 && res.status < 300) {
      const resourceNames = Array.isArray(res.data?.resourceNames) ? res.data.resourceNames : [];
      const customerIds = resourceNames
        .map((name) => normalizeCustomerId(String(name).replace(/^customers\//, '')))
        .filter(Boolean);

      console.log('Result: SUCCESS');
      console.log('Accessible customer count:', customerIds.length);
      console.log('Customer IDs:', customerIds.map((id) => redact(id)).join(', ') || '(none)');
      console.log('');
      console.log('Verdict: Developer token is NOT blocking listAccessibleCustomers for this OAuth user.');
      return;
    }

    console.log('Response body:', JSON.stringify(res.data, null, 2));
    const parsed = parseAuthorizationError(res.data);
    console.log('');
    console.log('authorizationError:', parsed.authorizationError ?? '(none)');
    console.log('requestId:', parsed.requestId ?? '(none)');
    console.log('');
    console.log('Verdict:', interpret(parsed.authorizationError));
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
  }

  process.exitCode = 1;
}

main().catch((err) => {
  console.error('Fatal:', err.message || err);
  process.exitCode = 1;
});
