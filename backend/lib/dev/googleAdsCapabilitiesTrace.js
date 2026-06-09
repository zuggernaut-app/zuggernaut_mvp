'use strict';

const crypto = require('crypto');
const axios = require('axios');
const mongoose = require('mongoose');
const { getFreshGoogleAccessToken } = require('../../services/integrations/googleTokenService');
const {
  buildGoogleAdsApiUrl,
  getGoogleAdsApiVersion,
  getGoogleAdsRequestTimeoutMs,
  normalizeCustomerId,
  getGoogleAdsDeveloperToken,
  getGoogleAdsLoginCustomerId,
} = require('../../services/integrations/googleAdsApiConfig');

const PROVIDER = 'google_ads';

/**
 * @typedef {{
 *   id: string,
 *   label: string,
 *   ok: boolean,
 *   skipped?: boolean,
 *   detail?: string,
 *   data?: Record<string, unknown>,
 *   hint?: string,
 * }} CapabilityStageResult
 */

/**
 * @param {string} label
 * @param {boolean} ok
 * @param {Partial<CapabilityStageResult>} [extra]
 * @returns {CapabilityStageResult}
 */
function capabilityStage(label, ok, extra = {}) {
  return {
    id: extra.id ?? label.toLowerCase().replace(/\s+/g, '_'),
    label,
    ok,
    ...extra,
  };
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
  const failure = details.find((row) => String(row['@type'] ?? '').includes('GoogleAdsFailure'));
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

/**
 * @param {object} params
 */
async function runCapabilityStep(params) {
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

  const res = await axios({
    method,
    url,
    data: body,
    headers,
    timeout: getGoogleAdsRequestTimeoutMs(),
    validateStatus: () => true,
  });

  if (res.status >= 200 && res.status < 300) {
    return {
      stepId,
      kind,
      ok: true,
      status: res.status,
      resourceName: res.data?.results?.[0]?.resourceName ?? null,
      loginCustomerId: headers['login-customer-id'] ?? null,
      preview:
        Array.isArray(res.data?.results) && res.data.results.length > 0
          ? res.data.results.slice(0, 3)
          : res.data,
    };
  }

  const parsed = parseGoogleAdsFailure(res.data);
  return {
    stepId,
    kind,
    ok: false,
    status: res.status,
    loginCustomerId: headers['login-customer-id'] ?? null,
    ...parsed,
  };
}

/**
 * @param {{
 *   businessId: string,
 *   customerId?: string,
 *   skipReads?: boolean,
 *   skipWrites?: boolean,
 *   includeCampaign?: boolean,
 * }} options
 */
async function resolveGoogleAdsCapabilityContext(options) {
  const businessId = options.businessId?.trim();
  if (!businessId) {
    throw new Error('businessId required for Google Ads capability trace');
  }

  const IntegrationConnection = mongoose.model('IntegrationConnection');
  const conn = await IntegrationConnection.findOne({ businessId, provider: PROVIDER })
    .select('providerIdentifiers')
    .lean();

  const accessToken = await getFreshGoogleAccessToken({ businessId, provider: PROVIDER });
  const ids = conn?.providerIdentifiers ?? {};
  const customerId =
    normalizeCustomerId(options.customerId) ||
    normalizeCustomerId(ids.customerId) ||
    normalizeCustomerId(ids.accessibleCustomerIds?.[0]);

  if (!customerId) {
    return {
      ok: false,
      errorCode: 'SELECTION_REQUIRED',
      message: 'No customerId on IntegrationConnection. Save Google Ads selection in Dev Integrations first.',
      customerId: null,
      accessToken: null,
      loginCustomerId: getGoogleAdsLoginCustomerId(),
      connectionLoginCustomerId: normalizeCustomerId(ids.loginCustomerId),
      managerCustomerId: normalizeCustomerId(ids.managerCustomerId),
    };
  }

  return {
    ok: true,
    accessToken,
    accessTokenSource: `Mongo IntegrationConnection (${businessId})`,
    customerId,
    loginCustomerId: getGoogleAdsLoginCustomerId(),
    connectionLoginCustomerId: normalizeCustomerId(ids.loginCustomerId),
    managerCustomerId: normalizeCustomerId(ids.managerCustomerId),
    apiVersion: getGoogleAdsApiVersion(),
    developerToken: redactToken(getGoogleAdsDeveloperToken()),
  };
}

/**
 * @param {CapabilityStageResult & { stepId?: string, kind?: string, skipped?: boolean, authorizationError?: string, status?: number, stepMessage?: string, googleMessage?: string, requestId?: string, resourceName?: string, loginCustomerId?: string }} stepResult
 * @param {string} label
 */
function stepToStage(stepResult, label) {
  if (stepResult.skipped) {
    return capabilityStage(label, true, {
      id: stepResult.stepId,
      skipped: true,
      detail: stepResult.googleMessage ?? 'Skipped',
      data: stepResult,
    });
  }

  const auth = stepResult.authorizationError ? ` [${stepResult.authorizationError}]` : '';
  const detail = stepResult.ok
    ? `HTTP ${stepResult.status} OK`
    : `HTTP ${stepResult.status}${auth}: ${stepResult.stepMessage ?? stepResult.googleMessage ?? 'request failed'}`;

  return capabilityStage(label, stepResult.ok === true, {
    id: stepResult.stepId,
    detail,
    data: {
      kind: stepResult.kind,
      status: stepResult.status,
      authorizationError: stepResult.authorizationError ?? null,
      requestId: stepResult.requestId ?? null,
      resourceName: stepResult.resourceName ?? null,
      loginCustomerId: stepResult.loginCustomerId ?? null,
    },
    hint: stepResult.authorizationError
      ? 'Check OAuth user access on target account, login-customer-id (MCC), and developer token access level.'
      : undefined,
  });
}

/**
 * @param {{
 *   businessId: string,
 *   customerId?: string,
 *   skipReads?: boolean,
 *   skipWrites?: boolean,
 *   includeCampaign?: boolean,
 * }} options
 * @returns {Promise<{
 *   stages: CapabilityStageResult[],
 *   context: Record<string, unknown> | null,
 *   interpretation: string | null,
 * }>}
 */
async function runGoogleAdsCapabilitiesTrace(options = {}) {
  const stages = [];
  const suffix = crypto.randomUUID().slice(0, 8);

  let ctx;
  try {
    ctx = await resolveGoogleAdsCapabilityContext(options);
  } catch (err) {
    stages.push(
      capabilityStage('Google Ads capability context', false, {
        id: 'google_ads_capability_context',
        detail: err instanceof Error ? err.message : String(err),
        hint: 'Connect OAuth and select a Google Ads customer before running extended trace.',
      }),
    );
    return { stages, context: null, interpretation: null };
  }

  if (!ctx.ok) {
    stages.push(
      capabilityStage('Google Ads capability context', false, {
        id: 'google_ads_capability_context',
        detail: `${ctx.errorCode}: ${ctx.message}`,
        hint: 'Pick a Google Ads customer on Dev Integrations, then re-run extended trace.',
      }),
    );
    return { stages, context: ctx, interpretation: null };
  }

  stages.push(
    capabilityStage('Google Ads capability context', true, {
      id: 'google_ads_capability_context',
      detail: `customerId=${redactCustomerId(ctx.customerId)}, login-customer-id=${redactCustomerId(ctx.loginCustomerId) ?? '(not set)'}`,
      data: {
        apiVersion: ctx.apiVersion,
        developerToken: ctx.developerToken,
        accessTokenSource: ctx.accessTokenSource,
        customerId: redactCustomerId(ctx.customerId),
        loginCustomerId: redactCustomerId(ctx.loginCustomerId),
        connectionLoginCustomerId: redactCustomerId(ctx.connectionLoginCustomerId),
        managerCustomerId: redactCustomerId(ctx.managerCustomerId),
      },
    }),
  );

  const stepResults = [];

  if (!options.skipReads) {
    stepResults.push(
      await runCapabilityStep({
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
    stages.push(stepToStage(stepResults.at(-1), 'Read customer metadata'));

    stepResults.push(
      await runCapabilityStep({
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
    stages.push(stepToStage(stepResults.at(-1), 'Read customer user access'));

    if (ctx.loginCustomerId && ctx.loginCustomerId !== ctx.customerId) {
      stepResults.push(
        await runCapabilityStep({
          stepId: 'read_mcc_customer_client_link',
          kind: 'read',
          customerId: ctx.loginCustomerId,
          accessToken: ctx.accessToken,
          method: 'POST',
          resourcePath: `customers/${ctx.loginCustomerId}/googleAds:search`,
          body: {
            query: `SELECT customer_client.client_customer, customer_client.status, customer_client.manager_link_id FROM customer_client WHERE customer_client.client_customer = 'customers/${ctx.customerId}'`,
          },
          loginCustomerId: ctx.loginCustomerId,
        }),
      );
      stages.push(stepToStage(stepResults.at(-1), 'Read MCC customer client link'));
    } else {
      const skipped = {
        stepId: 'read_mcc_customer_client_link',
        kind: 'read',
        skipped: true,
        googleMessage:
          ctx.loginCustomerId === ctx.customerId
            ? 'Target account is the login customer; MCC link query not applicable.'
            : 'GOOGLE_ADS_LOGIN_CUSTOMER_ID not set.',
      };
      stepResults.push(skipped);
      stages.push(stepToStage(skipped, 'Read MCC customer client link'));
    }
  }

  let createdBudgetResourceName = null;

  if (!options.skipWrites) {
    const budgetResult = await runCapabilityStep({
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
              name: `ZUG_DEBUG_BUDGET_${suffix}`,
              amountMicros: '10000000',
              deliveryMethod: 'STANDARD',
              explicitlyShared: false,
            },
          },
        ],
      },
    });
    stepResults.push(budgetResult);
    stages.push(stepToStage(budgetResult, 'Write campaign budget'));
    if (budgetResult.ok) {
      createdBudgetResourceName = budgetResult.resourceName;
    }

    const convResult = await runCapabilityStep({
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
    });
    stepResults.push(convResult);
    stages.push(stepToStage(convResult, 'Write conversion action'));

    const budgetForCampaign =
      process.env.GOOGLE_ADS_CAMPAIGN_BUDGET_RESOURCE_NAME?.trim() ||
      (options.includeCampaign ? createdBudgetResourceName : null);

    if (budgetForCampaign) {
      const campaignResult = await runCapabilityStep({
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
      });
      stepResults.push(campaignResult);
      stages.push(stepToStage(campaignResult, 'Write search campaign'));
    } else {
      const skipped = {
        stepId: 'write_search_campaign',
        kind: 'write',
        skipped: true,
        googleMessage: 'Pass --include-campaign or set GOOGLE_ADS_CAMPAIGN_BUDGET_RESOURCE_NAME.',
      };
      stepResults.push(skipped);
      stages.push(stepToStage(skipped, 'Write search campaign'));
    }
  }

  const writeResults = stepResults.filter((row) => row.kind === 'write' && row.ok !== null && !row.skipped);
  const budgetOk = writeResults.find((row) => row.stepId === 'write_campaign_budget')?.ok === true;
  const convOk = writeResults.find((row) => row.stepId === 'write_conversion_action')?.ok === true;

  let interpretation = null;
  if (writeResults.length > 0) {
    if (budgetOk && convOk) {
      interpretation =
        'Budget and conversion writes both work — any creation diagnostics failure may be flow-specific.';
    } else if (!budgetOk && convOk) {
      interpretation = 'Conversion write works but budget write fails — likely budget-specific permission or payload.';
    } else if (!budgetOk && !convOk) {
      interpretation =
        'All writes fail — likely OAuth user/MCC call-structure or developer token access level.';
    } else if (budgetOk && !convOk) {
      interpretation = 'Budget write works but conversion write fails — compare authorizationError codes.';
    }
  }

  return { stages, context: ctx, interpretation };
}

module.exports = {
  capabilityStage,
  parseGoogleAdsFailure,
  runCapabilityStep,
  resolveGoogleAdsCapabilityContext,
  runGoogleAdsCapabilitiesTrace,
  redactCustomerId,
  redactToken,
};
