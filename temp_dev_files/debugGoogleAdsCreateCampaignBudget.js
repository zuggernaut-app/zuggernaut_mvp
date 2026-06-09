/**
 * Standalone diagnostic: mutate a single Google Ads campaign budget.
 *
 * Isolated from Jest (`jest.config.js` only runs `tests/`). Use this to debug
 * PERMISSION_DENIED / header / customer-id issues without creation diagnostics.
 *
 * Mode A — access token + customer id from env:
 *   set GOOGLE_ADS_DEVELOPER_TOKEN=...
 *   set GOOGLE_ADS_ACCESS_TOKEN=...
 *   set GOOGLE_ADS_CUSTOMER_ID=7809414862
 *   node scripts/debugGoogleAdsCreateCampaignBudget.js
 *
 * Mode B — load OAuth + selected customer from Mongo:
 *   node scripts/debugGoogleAdsCreateCampaignBudget.js <businessId>
 *
 * Mode C — Mongo token, explicit customer override:
 *   node scripts/debugGoogleAdsCreateCampaignBudget.js <businessId> <customerId>
 *
 * Optional env:
 *   GOOGLE_ADS_API_VERSION=v24
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID=3462198684  (sent as login-customer-id when set)
 *   DEBUG_ADS_BUDGET_SKIP_VARIANTS=1         (only run the primary attempt)
 *
 * Requires: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_API_ENABLED=true, GOOGLE_ADS_API_MOCK=false
 * Mode B/C also need: MONGODB_URI, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY
 */
'use strict';

const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const axios = require('axios');
const mongoose = require('mongoose');
require('../models');
const { getFreshGoogleAccessToken } = require('../services/integrations/googleTokenService');
const {
  buildGoogleAdsApiUrl,
  getGoogleAdsApiVersion,
  getGoogleAdsRequestTimeoutMs,
  normalizeCustomerId,
  getGoogleAdsDeveloperToken,
  getGoogleAdsLoginCustomerId,
} = require('../services/integrations/googleAdsApiConfig');

const PROVIDER = 'google_ads';
const uri =
  process.env.MONGODB_URI ||
  process.env.mongodb_uri ||
  'mongodb://localhost:27017/zuggernaut';

function usage() {
  console.error('Usage:');
  console.error('  GOOGLE_ADS_ACCESS_TOKEN=... GOOGLE_ADS_CUSTOMER_ID=... node scripts/debugGoogleAdsCreateCampaignBudget.js');
  console.error('  node scripts/debugGoogleAdsCreateCampaignBudget.js <businessId>');
  console.error('  node scripts/debugGoogleAdsCreateCampaignBudget.js <businessId> <customerId>');
  process.exit(1);
}

function redactToken(value) {
  if (!value || typeof value !== 'string') return null;
  if (value.length <= 8) return '****';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function redactCustomerId(customerId) {
  const normalized = normalizeCustomerId(customerId);
  if (!normalized) return null;
  if (normalized.length <= 4) return '****';
  return `…${normalized.slice(-4)}`;
}

function buildBudgetPayload(resourceLabel) {
  return {
    operations: [
      {
        create: {
          name: resourceLabel,
          amountMicros: '10000000',
          deliveryMethod: 'STANDARD',
          explicitlyShared: false,
        },
      },
    ],
  };
}

function buildHeaders(accessToken, { loginCustomerId, includeLoginCustomerId = true }) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    'developer-token': getGoogleAdsDeveloperToken(),
    'Content-Type': 'application/json',
  };

  if (includeLoginCustomerId === false) {
    return headers;
  }

  const loginId =
    loginCustomerId !== undefined ? normalizeCustomerId(loginCustomerId) : getGoogleAdsLoginCustomerId();

  if (loginId) {
    headers['login-customer-id'] = loginId;
  }

  return headers;
}

async function resolveContext(argvBusinessId, argvCustomerId) {
  const fromEnvToken = process.env.GOOGLE_ADS_ACCESS_TOKEN?.trim();
  const fromEnvCustomerId = normalizeCustomerId(process.env.GOOGLE_ADS_CUSTOMER_ID);

  if (fromEnvToken && (fromEnvCustomerId || argvCustomerId)) {
    return {
      accessToken: fromEnvToken,
      accessTokenSource: 'GOOGLE_ADS_ACCESS_TOKEN',
      customerId: normalizeCustomerId(argvCustomerId) || fromEnvCustomerId,
      connectionLoginCustomerId: null,
      managerCustomerId: null,
    };
  }

  const businessId = argvBusinessId?.trim();
  if (!businessId) {
    usage();
  }

  await mongoose.connect(uri);
  const IntegrationConnection = mongoose.model('IntegrationConnection');
  const conn = await IntegrationConnection.findOne({ businessId, provider: PROVIDER })
    .select('providerIdentifiers')
    .lean();

  const accessToken = await getFreshGoogleAccessToken({ businessId, provider: PROVIDER });
  const ids = conn?.providerIdentifiers ?? {};
  const customerId =
    normalizeCustomerId(argvCustomerId) ||
    normalizeCustomerId(ids.customerId) ||
    normalizeCustomerId(ids.accessibleCustomerIds?.[0]);

  if (!customerId) {
    throw new Error(
      'No customerId on IntegrationConnection. Save Google Ads selection in Dev Integrations first, or pass customerId as the second argument.',
    );
  }

  return {
    accessToken,
    accessTokenSource: `Mongo IntegrationConnection (${businessId})`,
    customerId,
    connectionLoginCustomerId: normalizeCustomerId(ids.loginCustomerId),
    managerCustomerId: normalizeCustomerId(ids.managerCustomerId),
    businessId,
  };
}

/**
 * @param {object} params
 */
async function mutateCampaignBudget(params) {
  const { variantLabel, customerId, accessToken, loginCustomerId, includeLoginCustomerId } = params;
  const resourceLabel = `ZUG_DEBUG_BUDGET_${crypto.randomUUID().slice(0, 8)}`;
  const url = buildGoogleAdsApiUrl(`customers/${customerId}/campaignBudgets:mutate`);
  const body = buildBudgetPayload(resourceLabel);
  const headers = buildHeaders(accessToken, { loginCustomerId, includeLoginCustomerId });

  console.log(`\n=== Attempt: ${variantLabel} ===`);
  console.log('URL:', url);
  console.log('API version:', getGoogleAdsApiVersion());
  console.log('Target customerId:', redactCustomerId(customerId));
  console.log('Headers:', {
    Authorization: `Bearer ${redactToken(accessToken)}`,
    'developer-token': redactToken(headers['developer-token']),
    'login-customer-id': headers['login-customer-id'] ?? '(omitted)',
    'Content-Type': headers['Content-Type'],
  });
  console.log('Body:', JSON.stringify(body, null, 2));

  const res = await axios.post(url, body, {
    headers,
    timeout: getGoogleAdsRequestTimeoutMs(),
    validateStatus: () => true,
  });

  console.log('HTTP status:', res.status);
  if (res.status >= 200 && res.status < 300) {
    console.log('Success:', JSON.stringify(res.data, null, 2));
    return { ok: true, variantLabel, resourceName: res.data?.results?.[0]?.resourceName ?? null };
  }

  console.log('Error body:', JSON.stringify(res.data, null, 2));
  const googleStatus = res.data?.error?.status ?? null;
  const googleMessage = res.data?.error?.message ?? null;
  return {
    ok: false,
    variantLabel,
    status: res.status,
    googleStatus,
    googleMessage,
  };
}

async function main() {
  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    console.warn('Warning: GOOGLE_ADS_API_MOCK=true — forcing real API for this diagnostic run.');
    process.env.GOOGLE_ADS_API_MOCK = 'false';
  }
  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    throw new Error('Set GOOGLE_ADS_API_ENABLED=true before running this script.');
  }

  const argvBusinessId = process.argv[2] ?? null;
  const argvCustomerId = process.argv[3] ?? null;

  console.log('Google Ads campaignBudgets:mutate standalone check');
  console.log('Developer token:', redactToken(getGoogleAdsDeveloperToken()));
  console.log('Env login-customer-id:', redactCustomerId(getGoogleAdsLoginCustomerId()) ?? '(not set)');

  let ctx;
  try {
    ctx = await resolveContext(argvBusinessId, argvCustomerId);
    console.log('Access token source:', ctx.accessTokenSource);
    console.log('Target customerId:', redactCustomerId(ctx.customerId));
    if (ctx.connectionLoginCustomerId) {
      console.log('Connection loginCustomerId:', redactCustomerId(ctx.connectionLoginCustomerId));
    }
    if (ctx.managerCustomerId) {
      console.log('Connection managerCustomerId:', redactCustomerId(ctx.managerCustomerId));
    }

    const skipVariants = process.env.DEBUG_ADS_BUDGET_SKIP_VARIANTS === '1';
    const variants = [
      {
        variantLabel: 'default headers (env login-customer-id if set)',
        loginCustomerId: undefined,
        includeLoginCustomerId: true,
      },
    ];

    if (!skipVariants) {
      variants.push({
        variantLabel: 'omit login-customer-id (direct client account)',
        loginCustomerId: undefined,
        includeLoginCustomerId: false,
      });

      if (ctx.connectionLoginCustomerId && ctx.connectionLoginCustomerId !== ctx.customerId) {
        variants.push({
          variantLabel: 'connection loginCustomerId from providerIdentifiers',
          loginCustomerId: ctx.connectionLoginCustomerId,
          includeLoginCustomerId: true,
        });
      }
    }

    const results = [];
    for (const variant of variants) {
      const result = await mutateCampaignBudget({
        ...variant,
        customerId: ctx.customerId,
        accessToken: ctx.accessToken,
      });
      results.push(result);
      if (result.ok) {
        console.log(`\nBudget created via "${variant.variantLabel}".`);
        console.log('resourceName:', result.resourceName);
        console.log(
          '\nNote: this creates a real test budget in Google Ads. Remove it from the Ads UI if not needed.',
        );
        return;
      }
    }

    console.log('\n=== Summary (all attempts failed) ===');
    for (const row of results) {
      console.log(
        `- ${row.variantLabel}: HTTP ${row.status} ${row.googleStatus ?? ''} ${row.googleMessage ?? ''}`.trim(),
      );
    }
    process.exitCode = 1;
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
