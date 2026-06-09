/**
 * Standalone diagnostic: isolate Google Ads read vs write capabilities.
 *
 * Isolated from Jest (`jest.config.js` only runs `tests/`).
 *
 * Runs, in order:
 *   1. Read  — customer metadata (googleAds:search)
 *   2. Read  — customer_user_access for OAuth user visibility
 *   3. Read  — MCC customer_client link (when login-customer-id is set)
 *   4. Write — campaignBudgets:mutate
 *   5. Write — conversionActions:mutate (independent of budgets)
 *   6. Write — campaigns:mutate (optional; needs existing budget resource name)
 *
 * Mode A — access token + customer id from env:
 *   set GOOGLE_ADS_ACCESS_TOKEN=...
 *   set GOOGLE_ADS_CUSTOMER_ID=7809414862
 *   node scripts/debugGoogleAdsWriteCapabilities.js
 *
 * Mode B — Mongo OAuth + selected customer:
 *   node scripts/debugGoogleAdsWriteCapabilities.js <businessId>
 *
 * Mode C — Mongo OAuth, explicit customer override:
 *   node scripts/debugGoogleAdsWriteCapabilities.js <businessId> <customerId>
 *
 * Optional env:
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID=3462198684
 *   GOOGLE_ADS_CAMPAIGN_BUDGET_RESOURCE_NAME=customers/.../campaignBudgets/...
 *   DEBUG_ADS_WRITE_INCLUDE_CAMPAIGN=1   (run step 6 even without env budget name if step 4 succeeds)
 *   DEBUG_ADS_WRITE_SKIP_READS=1
 *
 * Requires: GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_API_ENABLED=true, GOOGLE_ADS_API_MOCK=false
 */
'use strict';

const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const axios = require('axios');
const { mongoose } = require('../shared');
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
  console.error(
    '  GOOGLE_ADS_ACCESS_TOKEN=... GOOGLE_ADS_CUSTOMER_ID=... node scripts/debugGoogleAdsWriteCapabilities.js',
  );
  console.error('  node scripts/debugGoogleAdsWriteCapabilities.js <businessId>');
  console.error('  node scripts/debugGoogleAdsWriteCapabilities.js <businessId> <customerId>');
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
  const authorizationError = first?.errorCode?.authorizationError ?? null;
  const requestId = failure?.requestId ?? null;
  return {
    googleStatus: body?.error?.status ?? null,
    googleMessage: body?.error?.message ?? null,
    authorizationError,
    stepMessage: first?.message ?? null,
    requestId,
  };
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
async function runStep(params) {
  const {
    stepId,
    kind,
    customerId,
    accessToken,
    method,
    resourcePath,
    body,
    loginCustomerId,
    includeLoginCustomerId = true,
  } = params;

  const url = buildGoogleAdsApiUrl(resourcePath);
  const headers = buildHeaders(accessToken, { loginCustomerId, includeLoginCustomerId });

  console.log(`\n=== ${stepId} (${kind}) ===`);
  console.log('URL:', url);
  console.log('Target customerId:', redactCustomerId(customerId));
  console.log('login-customer-id:', headers['login-customer-id'] ?? '(omitted)');
  if (body) {
    console.log('Body:', JSON.stringify(body, null, 2));
  }

  const res = await axios({
    method,
    url,
    data: body,
    headers,
    timeout: getGoogleAdsRequestTimeoutMs(),
    validateStatus: () => true,
  });

  console.log('HTTP status:', res.status);

  if (res.status >= 200 && res.status < 300) {
    const preview =
      Array.isArray(res.data?.results) && res.data.results.length > 0
        ? res.data.results.slice(0, 3)
        : res.data;
    console.log('Success preview:', JSON.stringify(preview, null, 2));
    return {
      stepId,
      kind,
      ok: true,
      status: res.status,
      resourceName: res.data?.results?.[0]?.resourceName ?? null,
      data: res.data,
    };
  }

  console.log('Error body:', JSON.stringify(res.data, null, 2));
  const parsed = parseGoogleAdsFailure(res.data);
  return {
    stepId,
    kind,
    ok: false,
    status: res.status,
    ...parsed,
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
  const suffix = crypto.randomUUID().slice(0, 8);
  const loginCustomerId = getGoogleAdsLoginCustomerId();

  console.log('Google Ads write-capabilities isolation check');
  console.log('API version:', getGoogleAdsApiVersion());
  console.log('Developer token:', redactToken(getGoogleAdsDeveloperToken()));
  console.log('Env login-customer-id:', redactCustomerId(loginCustomerId) ?? '(not set)');

  const results = [];
  let createdBudgetResourceName = null;

  try {
    const ctx = await resolveContext(argvBusinessId, argvCustomerId);
    console.log('Access token source:', ctx.accessTokenSource);
    console.log('Target customerId:', redactCustomerId(ctx.customerId));

    const skipReads = process.env.DEBUG_ADS_WRITE_SKIP_READS === '1';

    if (!skipReads) {
      results.push(
        await runStep({
          stepId: 'read_customer_metadata',
          kind: 'read',
          customerId: ctx.customerId,
          accessToken: ctx.accessToken,
          method: 'POST',
          resourcePath: `customers/${ctx.customerId}/googleAds:search`,
          body: {
            query:
              'SELECT customer.id, customer.descriptive_name, customer.manager, customer.status, customer.test_account FROM customer LIMIT 1',
          },
        }),
      );

      results.push(
        await runStep({
          stepId: 'read_customer_user_access',
          kind: 'read',
          customerId: ctx.customerId,
          accessToken: ctx.accessToken,
          method: 'POST',
          resourcePath: `customers/${ctx.customerId}/googleAds:search`,
          body: {
            query:
              'SELECT customer_user_access.user_id, customer_user_access.email_address, customer_user_access.access_role FROM customer_user_access LIMIT 20',
          },
        }),
      );

      if (loginCustomerId && loginCustomerId !== ctx.customerId) {
        results.push(
          await runStep({
            stepId: 'read_mcc_customer_client_link',
            kind: 'read',
            customerId: loginCustomerId,
            accessToken: ctx.accessToken,
            method: 'POST',
            resourcePath: `customers/${loginCustomerId}/googleAds:search`,
            body: {
              query: `SELECT customer_client.client_customer, customer_client.status, customer_client.manager_link_id FROM customer_client WHERE customer_client.client_customer = 'customers/${ctx.customerId}'`,
            },
            loginCustomerId,
          }),
        );
      }
    }

    const budgetLabel = `ZUG_DEBUG_BUDGET_${suffix}`;
    const budgetResult = await runStep({
      stepId: 'write_campaign_budget',
      kind: 'write',
      customerId: ctx.customerId,
      accessToken: ctx.accessToken,
      method: 'POST',
      resourcePath: `customers/${ctx.customerId}/campaignBudgets:mutate`,
      body: {
        operations: [
          {
            create: {
              name: budgetLabel,
              amountMicros: '10000000',
              deliveryMethod: 'STANDARD',
              explicitlyShared: false,
            },
          },
        ],
      },
    });
    results.push(budgetResult);
    if (budgetResult.ok) {
      createdBudgetResourceName = budgetResult.resourceName;
    }

    results.push(
      await runStep({
        stepId: 'write_conversion_action',
        kind: 'write',
        customerId: ctx.customerId,
        accessToken: ctx.accessToken,
        method: 'POST',
        resourcePath: `customers/${ctx.customerId}/conversionActions:mutate`,
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
      }),
    );

    const budgetForCampaign =
      process.env.GOOGLE_ADS_CAMPAIGN_BUDGET_RESOURCE_NAME?.trim() ||
      (process.env.DEBUG_ADS_WRITE_INCLUDE_CAMPAIGN === '1' ? createdBudgetResourceName : null);

    if (budgetForCampaign) {
      results.push(
        await runStep({
          stepId: 'write_search_campaign',
          kind: 'write',
          customerId: ctx.customerId,
          accessToken: ctx.accessToken,
          method: 'POST',
          resourcePath: `customers/${ctx.customerId}/campaigns:mutate`,
          body: {
            operations: [
              {
                create: {
                  name: `ZUG_DEBUG_CAMPAIGN_${suffix}`,
                  advertisingChannelType: 'SEARCH',
                  status: 'PAUSED',
                  campaignBudget: budgetForCampaign,
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
        }),
      );
    } else {
      console.log(
        '\n=== write_search_campaign (write) ===\nSkipped — set GOOGLE_ADS_CAMPAIGN_BUDGET_RESOURCE_NAME or DEBUG_ADS_WRITE_INCLUDE_CAMPAIGN=1 after budget succeeds.',
      );
      results.push({
        stepId: 'write_search_campaign',
        kind: 'write',
        ok: null,
        status: null,
        skipped: true,
        googleMessage: 'No budget resource name available.',
      });
    }

    console.log('\n=== Summary ===');
    for (const row of results) {
      if (row.skipped) {
        console.log(`- ${row.stepId}: skipped (${row.googleMessage})`);
        continue;
      }
      const auth = row.authorizationError ? ` [${row.authorizationError}]` : '';
      const status = row.ok ? 'OK' : 'FAIL';
      console.log(
        `- ${row.stepId}: ${status} HTTP ${row.status}${auth} ${row.stepMessage ?? row.googleMessage ?? ''}`.trim(),
      );
    }

    const writeResults = results.filter((row) => row.kind === 'write' && row.ok !== null);
    const budgetOk = writeResults.find((row) => row.stepId === 'write_campaign_budget')?.ok === true;
    const convOk = writeResults.find((row) => row.stepId === 'write_conversion_action')?.ok === true;

    console.log('\n=== Interpretation ===');
    if (budgetOk && convOk) {
      console.log('Budget and conversion writes both work — issue may be specific to creation diagnostics flow.');
    } else if (!budgetOk && convOk) {
      console.log('Conversion write works but budget write fails — likely budget-specific permission or payload issue.');
    } else if (!budgetOk && !convOk) {
      console.log(
        'All writes fail — likely OAuth user/MCC call-structure or developer token access level (see authorizationError above).',
      );
    } else if (budgetOk && !convOk) {
      console.log('Budget write works but conversion write fails — unusual; compare authorizationError codes.');
    }

    const anyWriteFailed = writeResults.some((row) => row.ok === false);
    if (anyWriteFailed) {
      process.exitCode = 1;
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
