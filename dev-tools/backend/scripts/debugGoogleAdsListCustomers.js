/**
 * Standalone diagnostic: call Google Ads customers:listAccessibleCustomers.
 *
 * Does not use Temporal, workflows, or the full discovery stack.
 * Use this to verify developer token + OAuth access token + API version.
 *
 * Mode A — access token from env:
 *   set GOOGLE_ADS_DEVELOPER_TOKEN=...
 *   set GOOGLE_ADS_ACCESS_TOKEN=...
 *   node scripts/debugGoogleAdsListCustomers.js
 *
 * Mode B — refresh token from Mongo for a business:
 *   node scripts/debugGoogleAdsListCustomers.js <businessId>
 *
 * Requires: GOOGLE_ADS_DEVELOPER_TOKEN
 * Mode B also needs: MONGODB_URI, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY
 */
'use strict';

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const axios = require('axios');
const { mongoose } = require('../shared');
require('../models');
const { getFreshGoogleAccessToken } = require('../services/integrations/googleTokenService');

const API_VERSION = process.env.GOOGLE_ADS_API_VERSION?.trim() || 'v24';
const ORIGIN = process.env.GOOGLE_ADS_API_ORIGIN?.trim() || 'https://googleads.googleapis.com';
const PROVIDER = 'google_ads';

const uri =
  process.env.MONGODB_URI ||
  process.env.mongodb_uri ||
  'mongodb://localhost:27017/zuggernaut';

function usage() {
  console.error('Usage:');
  console.error('  GOOGLE_ADS_ACCESS_TOKEN=... node scripts/debugGoogleAdsListCustomers.js');
  console.error('  node scripts/debugGoogleAdsListCustomers.js <businessId>');
  process.exit(1);
}

function must(name, value) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function buildUrl() {
  return `${ORIGIN}/${API_VERSION}/customers:listAccessibleCustomers`;
}

function redactToken(value) {
  if (!value || typeof value !== 'string') return null;
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function customerIdFromResourceName(resourceName) {
  if (typeof resourceName !== 'string') return null;
  const match = resourceName.match(/^customers\/(\d+)$/);
  return match ? match[1] : null;
}

async function resolveAccessToken(businessId) {
  const fromEnv = process.env.GOOGLE_ADS_ACCESS_TOKEN?.trim();
  if (fromEnv) {
    return { source: 'GOOGLE_ADS_ACCESS_TOKEN', accessToken: fromEnv };
  }

  if (!businessId) {
    usage();
  }

  await mongoose.connect(uri);
  const accessToken = await getFreshGoogleAccessToken({ businessId, provider: PROVIDER });
  return { source: `Mongo IntegrationConnection (${businessId})`, accessToken };
}

async function listAccessibleCustomers(accessToken, developerToken) {
  const url = buildUrl();
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': developerToken,
  };

  console.log('\n=== Request ===');
  console.log('URL:', url);
  console.log('API version:', API_VERSION);
  console.log('Headers:', {
    Authorization: `Bearer ${redactToken(accessToken)}`,
    'developer-token': redactToken(developerToken),
    'login-customer-id': headers['login-customer-id'] ?? '(omitted — correct for this endpoint)',
  });

  const res = await axios.get(url, {
    headers,
    timeout: 30_000,
    validateStatus: () => true,
  });

  console.log('\n=== Response ===');
  console.log('HTTP status:', res.status);

  if (res.status < 200 || res.status >= 300) {
    console.log('Error body:', JSON.stringify(res.data, null, 2));
    return { ok: false, status: res.status, data: res.data };
  }

  const resourceNames = Array.isArray(res.data?.resourceNames) ? res.data.resourceNames : [];
  const customerIds = resourceNames.map(customerIdFromResourceName).filter(Boolean);

  console.log('resourceNames:', resourceNames);
  console.log('customerIds:', customerIds);
  console.log('count:', customerIds.length);

  return { ok: true, status: res.status, customerIds, resourceNames };
}

async function main() {
  const businessId = process.argv[2]?.trim() || null;
  const developerToken = must('GOOGLE_ADS_DEVELOPER_TOKEN', process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim());

  console.log('Google Ads listAccessibleCustomers standalone check');
  console.log('Developer token:', redactToken(developerToken));
  if (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.trim()) {
    console.log(
      'Note: GOOGLE_ADS_LOGIN_CUSTOMER_ID is set but will NOT be sent for listAccessibleCustomers.',
    );
  }

  let tokenSource = null;
  try {
    const resolved = await resolveAccessToken(businessId);
    tokenSource = resolved.source;
    console.log('Access token source:', tokenSource);

    const result = await listAccessibleCustomers(resolved.accessToken, developerToken);
    if (!result.ok) {
      process.exitCode = 1;
      return;
    }

    if (result.customerIds.length === 0) {
      console.log('\nNo accessible customers returned. OAuth may be valid but this Google user has no direct Ads account access.');
    } else {
      console.log('\nSuccess — accessible customers found.');
    }
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
  }
}

main().catch((err) => {
  console.error('\nFatal:', err.message || err);
  if (err.code) {
    console.error('Code:', err.code);
  }
  process.exitCode = 1;
});
