/**
 * Standalone diagnostic for Google Ads manager account 294-017-8860 (2940178860).
 *
 * Same env + Mongo OAuth as other debug scripts; only the target customer differs.
 * Tries three login-customer-id strategies (manager accounts often need self-login):
 *   1. login-customer-id = target manager (2940178860)
 *   2. login-customer-id = GOOGLE_ADS_LOGIN_CUSTOMER_ID from .env
 *   3. omit login-customer-id
 *
 * Isolated from Jest.
 *
 * Usage:
 *   node scripts/debugGoogleAdsAccount2940178860.js <businessId>
 *   npm run debug:google-ads-account-2940178860 -- <businessId>
 *
 * Requires: GOOGLE_ADS_DEVELOPER_TOKEN (Basic Access), GOOGLE_ADS_API_ENABLED=true
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

const TARGET_CUSTOMER_ID = '2940178860';
const PROVIDER = 'google_ads';
const uri =
  process.env.MONGODB_URI ||
  process.env.mongodb_uri ||
  'mongodb://localhost:27017/zuggernaut';

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

function buildHeaders(accessToken, { loginCustomerId, includeLoginCustomerId = true } = {}) {
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

function parseGoogleAdsFailure(body) {
  const details = Array.isArray(body?.error?.details) ? body.error.details : [];
  const failure = details.find((row) =>
    String(row['@type'] ?? '').includes('GoogleAdsFailure'),
  );
  const errors = Array.isArray(failure?.errors) ? failure.errors : [];
  const first = errors[0] ?? null;
  return {
    googleStatus: body?.error?.status ?? null,
    googleMessage: body?.error?.message ?? null,
    authorizationError: first?.errorCode?.authorizationError ?? null,
    stepMessage: first?.message ?? null,
    requestId: failure?.requestId ?? null,
  };
}

async function resolveAccessToken(businessId) {
  await mongoose.connect(uri);
  const accessToken = await getFreshGoogleAccessToken({ businessId, provider: PROVIDER });
  return {
    accessToken,
    accessTokenSource: `Mongo IntegrationConnection (${businessId})`,
  };
}

async function apiPost({ accessToken, customerId, resourcePath, body, loginCustomerId, includeLoginCustomerId }) {
  const url = buildGoogleAdsApiUrl(resourcePath.startsWith('customers/') ? resourcePath : `customers/${customerId}/${resourcePath}`);
  const headers = buildHeaders(accessToken, { loginCustomerId, includeLoginCustomerId });
  const res = await axios.post(url, body, {
    headers,
    timeout: getGoogleAdsRequestTimeoutMs(),
    validateStatus: () => true,
  });
  return { res, headers };
}

async function runVariant(variantLabel, accessToken, headerOpts) {
  const suffix = crypto.randomUUID().slice(0, 8);
  const steps = [];

  console.log(`\n########## Header variant: ${variantLabel} ##########`);

  const readMeta = await apiPost({
    accessToken,
    customerId: TARGET_CUSTOMER_ID,
    resourcePath: `customers/${TARGET_CUSTOMER_ID}/googleAds:search`,
    body: {
      query:
        'SELECT customer.id, customer.descriptive_name, customer.manager, customer.status, customer.test_account FROM customer LIMIT 1',
    },
    ...headerOpts,
  });

  console.log('\n--- read_customer_metadata ---');
  console.log('HTTP:', readMeta.res.status);
  console.log('login-customer-id:', readMeta.headers['login-customer-id'] ?? '(omitted)');
  if (readMeta.res.status >= 200 && readMeta.res.status < 300) {
    console.log('OK:', JSON.stringify(readMeta.res.data?.results?.[0] ?? readMeta.res.data, null, 2));
    steps.push({ step: 'read_customer_metadata', ok: true });
  } else {
    console.log('FAIL:', JSON.stringify(readMeta.res.data, null, 2));
    const parsed = parseGoogleAdsFailure(readMeta.res.data);
    steps.push({ step: 'read_customer_metadata', ok: false, ...parsed });
    return { variantLabel, steps, halted: true };
  }

  const readAccess = await apiPost({
    accessToken,
    customerId: TARGET_CUSTOMER_ID,
    resourcePath: `customers/${TARGET_CUSTOMER_ID}/googleAds:search`,
    body: {
      query:
        'SELECT customer_user_access.user_id, customer_user_access.email_address, customer_user_access.access_role FROM customer_user_access LIMIT 20',
    },
    ...headerOpts,
  });

  console.log('\n--- read_customer_user_access ---');
  console.log('HTTP:', readAccess.res.status);
  steps.push({
    step: 'read_customer_user_access',
    ok: readAccess.res.status >= 200 && readAccess.res.status < 300,
    ...(readAccess.res.status >= 300 ? parseGoogleAdsFailure(readAccess.res.data) : {}),
  });
  if (readAccess.res.status < 300) {
    console.log('OK:', JSON.stringify(readAccess.res.data?.results?.slice(0, 5) ?? [], null, 2));
  } else {
    console.log('FAIL:', JSON.stringify(readAccess.res.data, null, 2));
  }

  const budget = await apiPost({
    accessToken,
    customerId: TARGET_CUSTOMER_ID,
    resourcePath: `customers/${TARGET_CUSTOMER_ID}/campaignBudgets:mutate`,
    body: {
      operations: [
        {
          create: {
            name: `ZUG_DEBUG_BUDGET_${suffix}`,
            amountMicros: '10000000',
            deliveryMethod: 'STANDARD',
            explicitlyShared: false,
          },
        },
      ],
    },
    ...headerOpts,
  });

  console.log('\n--- write_campaign_budget ---');
  console.log('HTTP:', budget.res.status);
  let budgetResourceName = null;
  if (budget.res.status >= 200 && budget.res.status < 300) {
    budgetResourceName = budget.res.data?.results?.[0]?.resourceName ?? null;
    console.log('OK:', budgetResourceName);
    steps.push({ step: 'write_campaign_budget', ok: true, resourceName: budgetResourceName });
  } else {
    console.log('FAIL:', JSON.stringify(budget.res.data, null, 2));
    steps.push({ step: 'write_campaign_budget', ok: false, ...parseGoogleAdsFailure(budget.res.data) });
  }

  const conv = await apiPost({
    accessToken,
    customerId: TARGET_CUSTOMER_ID,
    resourcePath: `customers/${TARGET_CUSTOMER_ID}/conversionActions:mutate`,
    body: {
      operations: [
        {
          create: {
            name: `ZUG_DEBUG_CONV_${suffix}`,
            category: 'DEFAULT',
            type: 'WEBPAGE',
            status: 'ENABLED',
            countingType: 'ONE_PER_CLICK',
          },
        },
      ],
    },
    ...headerOpts,
  });

  console.log('\n--- write_conversion_action ---');
  console.log('HTTP:', conv.res.status);
  if (conv.res.status >= 200 && conv.res.status < 300) {
    console.log('OK:', conv.res.data?.results?.[0]?.resourceName ?? conv.res.data);
    steps.push({ step: 'write_conversion_action', ok: true });
  } else {
    console.log('FAIL:', JSON.stringify(conv.res.data, null, 2));
    steps.push({ step: 'write_conversion_action', ok: false, ...parseGoogleAdsFailure(conv.res.data) });
  }

  if (budgetResourceName) {
    const campaign = await apiPost({
      accessToken,
      customerId: TARGET_CUSTOMER_ID,
      resourcePath: `customers/${TARGET_CUSTOMER_ID}/campaigns:mutate`,
      body: {
        operations: [
          {
            create: {
              name: `ZUG_DEBUG_CAMPAIGN_${suffix}`,
              advertisingChannelType: 'SEARCH',
              status: 'PAUSED',
              campaignBudget: budgetResourceName,
              manualCpc: {},
              networkSettings: {
                targetGoogleSearch: true,
                targetSearchNetwork: false,
                targetContentNetwork: false,
              },
            },
          },
        ],
      },
      ...headerOpts,
    });

    console.log('\n--- write_search_campaign ---');
    console.log('HTTP:', campaign.res.status);
    if (campaign.res.status >= 200 && campaign.res.status < 300) {
      console.log('OK:', campaign.res.data?.results?.[0]?.resourceName ?? campaign.res.data);
      steps.push({ step: 'write_search_campaign', ok: true });
    } else {
      console.log('FAIL:', JSON.stringify(campaign.res.data, null, 2));
      steps.push({ step: 'write_search_campaign', ok: false, ...parseGoogleAdsFailure(campaign.res.data) });
    }
  } else {
    steps.push({ step: 'write_search_campaign', ok: null, skipped: true });
  }

  const halted = steps.some((row) => row.step === 'read_customer_metadata' && row.ok === false);
  return { variantLabel, steps, halted };
}

async function main() {
  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    process.env.GOOGLE_ADS_API_MOCK = 'false';
  }
  if (process.env.GOOGLE_ADS_API_ENABLED !== 'true') {
    throw new Error('Set GOOGLE_ADS_API_ENABLED=true before running this script.');
  }

  const businessId = process.argv[2]?.trim();
  if (!businessId) {
    console.error('Usage: node scripts/debugGoogleAdsAccount2940178860.js <businessId>');
    console.error(`Target: 294-017-8860 (${TARGET_CUSTOMER_ID}) — Zuggernaut AI Campaign Builder (manager)`);
    process.exit(1);
  }

  const envLoginCustomerId = getGoogleAdsLoginCustomerId();

  console.log('Google Ads account 294-017-8860 write-capabilities check');
  console.log('API version:', getGoogleAdsApiVersion());
  console.log('Developer token:', redactToken(getGoogleAdsDeveloperToken()));
  console.log('Env GOOGLE_ADS_LOGIN_CUSTOMER_ID:', redactCustomerId(envLoginCustomerId) ?? '(not set)');
  console.log('Target customerId:', redactCustomerId(TARGET_CUSTOMER_ID));

  const variants = [
    {
      variantLabel: 'manager self login-customer-id (2940178860)',
      headerOpts: { loginCustomerId: TARGET_CUSTOMER_ID, includeLoginCustomerId: true },
    },
    {
      variantLabel: 'env GOOGLE_ADS_LOGIN_CUSTOMER_ID',
      headerOpts: { loginCustomerId: undefined, includeLoginCustomerId: true },
    },
    {
      variantLabel: 'omit login-customer-id',
      headerOpts: { includeLoginCustomerId: false },
    },
  ];

  try {
    const { accessToken, accessTokenSource } = await resolveAccessToken(businessId);
    console.log('Access token source:', accessTokenSource);

    const allResults = [];
    for (const variant of variants) {
      const result = await runVariant(variant.variantLabel, accessToken, variant.headerOpts);
      allResults.push(result);
      const metaOk = result.steps.find((row) => row.step === 'read_customer_metadata')?.ok;
      if (metaOk) {
        console.log(`\n>>> Variant "${variant.variantLabel}" passed read — see write results above.`);
      }
    }

    console.log('\n=== Final summary ===');
    for (const variant of allResults) {
      console.log(`\n[${variant.variantLabel}]`);
      for (const step of variant.steps) {
        if (step.skipped) {
          console.log(`  - ${step.step}: skipped`);
          continue;
        }
        const auth = step.authorizationError ? ` [${step.authorizationError}]` : '';
        console.log(`  - ${step.step}: ${step.ok ? 'OK' : 'FAIL'}${auth}`);
      }
    }

    const anySuccess = allResults.some((variant) =>
      variant.steps.some((row) => row.ok === true && row.step?.startsWith('write_')),
    );
    if (!anySuccess) {
      process.exitCode = 1;
      console.log(
        '\nNo write operations succeeded. If OAuth user is not celluloid.leo@gmail.com, reconnect Google Ads with that account.',
      );
    }
  } finally {
    if (mongoose.connection.readyState === 1) {
      await mongoose.disconnect();
    }
  }
}

main().catch((err) => {
  console.error('\nFatal:', err.message || err);
  process.exitCode = 1;
});
