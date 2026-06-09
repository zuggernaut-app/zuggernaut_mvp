'use strict';

const {
  getGoogleAdsApiVersion,
  buildGoogleAdsHeaders,
  parseGoogleAdsApiError,
  redactCustomerId,
} = require('../integrations/googleAdsApiConfig');
const mongoose = require('mongoose');
require('../../models');
const { listAccessibleCustomers } = require('../integrations/googleAdsAccountClient');
const { getFreshGoogleAccessToken } = require('../integrations/googleTokenService');
const {
  getGoogleAdsLoginCustomerId,
  normalizeCustomerId,
} = require('../integrations/googleAdsApiConfig');
const { getConnectionStatus } = require('../capabilities/integrationConnectionService');
const { SELECTION_SOURCE } = require('../../constants/providerResourceSelection');
const { sanitizeIdentifiers } = require('./diagnosticsSanitizers');

const IntegrationConnection = mongoose.model('IntegrationConnection');

const OAUTH_FAILURE_REASONS = new Set([
  'missing_connection',
  'not_connected',
  'needs_reauth',
  'insufficient_scopes',
  'token_expired',
  'missing_tokens',
]);

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function runGoogleAdsDiagnostics(businessId) {
  const startedAt = new Date().toISOString();
  const apiVersion = getGoogleAdsApiVersion();
  const tests = [];

  const connection = await getConnectionStatus(businessId, 'google_ads', { attemptRefresh: true });
  const oauthOk = !OAUTH_FAILURE_REASONS.has(connection.reason);
  tests.push({
    name: 'oauth_connection',
    ok: oauthOk,
    includesLoginCustomerId: null,
    errorCode: oauthOk ? null : connection.reason.toUpperCase(),
    message: oauthOk
      ? connection.reason === 'provisioning_required'
        ? 'OAuth is ready; customer identifiers still need provisioning.'
        : 'OAuth connection is ready.'
      : `OAuth not ready (${connection.reason}).`,
    details: {
      scopesMissing: connection.scopesMissing ?? [],
      connectionHealth: connection.connectionHealth,
      identifiersReady: connection.ready,
      reason: connection.reason,
    },
  });

  if (!tests[0].ok) {
    return buildDiagnosticsResponse({
      startedAt,
      apiVersion,
      tests,
      connection,
      ok: false,
      errorCode: tests[0].errorCode,
      message: tests[0].message,
    });
  }

  let accessToken;
  try {
    accessToken = await getFreshGoogleAccessToken({ businessId, provider: 'google_ads' });
    tests.push({
      name: 'token_refresh',
      ok: true,
      includesLoginCustomerId: null,
      message: 'Access token refreshed successfully.',
    });
  } catch (err) {
    const code = typeof err.code === 'string' ? err.code : 'TOKEN_REFRESH_FAILED';
    tests.push({
      name: 'token_refresh',
      ok: false,
      includesLoginCustomerId: null,
      errorCode: code,
      message: err instanceof Error ? err.message : 'Token refresh failed.',
    });
    return buildDiagnosticsResponse({
      startedAt,
      apiVersion,
      tests,
      connection,
      ok: false,
      errorCode: code,
      message: tests.at(-1).message,
    });
  }

  const listHeaders = buildGoogleAdsHeaders(accessToken, {
    includeLoginCustomerId: false,
    includeContentType: false,
  });
  tests.push({
    name: 'list_accessible_customers_headers',
    ok: listHeaders['login-customer-id'] == null,
    includesLoginCustomerId: false,
    message:
      listHeaders['login-customer-id'] == null
        ? 'listAccessibleCustomers will omit login-customer-id.'
        : 'Unexpected login-customer-id on listAccessibleCustomers.',
  });

  try {
    const customerIds = await listAccessibleCustomers(accessToken);
    const redactedIds = customerIds.map((id) => redactCustomerId(id));
    tests.push({
      name: 'list_accessible_customers',
      ok: true,
      includesLoginCustomerId: false,
      message: `Found ${customerIds.length} accessible customer(s).`,
      details: {
        accessibleCustomerCount: customerIds.length,
        accessibleCustomerIds: redactedIds,
        selectedCustomerId: null,
      },
    });

    const mccHeaders = buildGoogleAdsHeaders(accessToken, {
      loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
    });
    tests.push({
      name: 'create_customer_client_headers',
      ok: mccHeaders['login-customer-id'] != null,
      includesLoginCustomerId: true,
      message: mccHeaders['login-customer-id']
        ? 'createCustomerClient will include login-customer-id.'
        : 'GOOGLE_ADS_LOGIN_CUSTOMER_ID is not configured for MCC provisioning.',
      details: {
        loginCustomerId: redactCustomerId(mccHeaders['login-customer-id']),
      },
    });

    const loginCustomerId = getGoogleAdsLoginCustomerId();
    const existingConn = await IntegrationConnection.findOne({ businessId, provider: 'google_ads' })
      .select('providerIdentifiers')
      .lean();
    const existingIds = existingConn?.providerIdentifiers ?? {};
    const existingCustomerId = normalizeCustomerId(existingIds.customerId);
    const explicitSelection =
      existingIds.selectionSource === SELECTION_SOURCE.DEV_INTEGRATIONS &&
      existingCustomerId &&
      customerIds.includes(existingCustomerId);

    const baseIdentifiers = {
      accessibleCustomerIds: customerIds,
      ...(loginCustomerId ? { loginCustomerId, managerCustomerId: loginCustomerId } : {}),
      discoveryRecordedAt: new Date().toISOString(),
      discoverySource: 'diagnostics',
    };

    let providerIdentifiers;
    let connectionHealth;

    if (customerIds.length === 0) {
      providerIdentifiers = {
        ...baseIdentifiers,
        discoveryReason: 'ADS_PROVISIONING_REQUIRED',
      };
      connectionHealth = 'provisioning_required';
    } else if (explicitSelection) {
      providerIdentifiers = {
        ...baseIdentifiers,
        customerId: existingCustomerId,
        selectedAt: existingIds.selectedAt ?? null,
        selectionSource: existingIds.selectionSource,
        selectedCustomerDescriptiveName: existingIds.selectedCustomerDescriptiveName ?? null,
        selectedCustomerKind: existingIds.selectedCustomerKind ?? null,
        selectedCustomerStatus: existingIds.selectedCustomerStatus ?? null,
        selectionRequired: false,
      };
      connectionHealth = 'connected';
    } else {
      providerIdentifiers = {
        ...baseIdentifiers,
        selectionRequired: true,
        discoveryReason: 'ADS_CUSTOMER_SELECTION_REQUIRED',
      };
      connectionHealth = 'selection_required';
    }

    await IntegrationConnection.findOneAndUpdate(
      { businessId, provider: 'google_ads' },
      {
        $set: {
          connectionHealth,
          providerIdentifiers,
        },
      }
    );

    const refreshedConnection = await getConnectionStatus(businessId, 'google_ads', {
      attemptRefresh: false,
    });
    const connIdentifiers = sanitizeIdentifiers(refreshedConnection.providerIdentifiers);
    const selectedCustomerId = explicitSelection
      ? redactCustomerId(existingCustomerId)
      : null;
    const provisionedCustomerId = connIdentifiers?.customerId
      ? redactCustomerId(connIdentifiers.customerId)
      : null;

    return buildDiagnosticsResponse({
      startedAt,
      apiVersion,
      tests,
      connection: refreshedConnection,
      ok: true,
      accessibleCustomerCount: customerIds.length,
      accessibleCustomerIds: redactedIds,
      selectedCustomerId,
      provisionedCustomerId,
      message: explicitSelection
        ? 'Google Ads diagnostics completed successfully.'
        : customerIds.length === 0
          ? 'OAuth is ready but no accessible Google Ads customers were found.'
          : 'OAuth is ready. Select a Google Ads customer account in Dev Integrations before creation diagnostics.',
    });
  } catch (err) {
    const googleAdsError = err.details ?? null;
    const parsed =
      googleAdsError ??
      parseGoogleAdsApiError(0, null, { action: 'listAccessibleCustomers' });

    tests.push({
      name: 'list_accessible_customers',
      ok: false,
      includesLoginCustomerId: false,
      errorCode: typeof err.code === 'string' ? err.code : 'GOOGLE_ADS_LIST_CUSTOMERS_FAILED',
      message: err instanceof Error ? err.message : 'listAccessibleCustomers failed.',
      googleErrorSummary: parsed,
    });

    return buildDiagnosticsResponse({
      startedAt,
      apiVersion,
      tests,
      connection,
      ok: false,
      errorCode: tests.at(-1).errorCode,
      message: tests.at(-1).message,
      googleErrorSummary: parsed,
    });
  }
}

/**
 * @param {object} payload
 */
function buildDiagnosticsResponse(payload) {
  const {
    startedAt,
    apiVersion,
    tests,
    connection,
    ok,
    errorCode,
    message,
    accessibleCustomerCount,
    accessibleCustomerIds,
    selectedCustomerId,
    provisionedCustomerId,
    googleErrorSummary,
  } = payload;

  return {
    provider: 'google_ads',
    ok,
    startedAt,
    apiVersion,
    errorCode: errorCode ?? null,
    message,
    connectionHealth: connection.connectionHealth ?? null,
    providerIdentifiers: sanitizeIdentifiers(connection.providerIdentifiers),
    tests,
    extra: {
      apiVersion,
      accessibleCustomerCount: accessibleCustomerCount ?? null,
      accessibleCustomerIds: accessibleCustomerIds ?? null,
      selectedCustomerId: selectedCustomerId ?? null,
      provisionedCustomerId: provisionedCustomerId ?? null,
      googleErrorSummary: googleErrorSummary ?? null,
    },
  };
}

module.exports = {
  runGoogleAdsDiagnostics,
};
