'use strict';

const { getConnectionStatus } = require('../../services/capabilities/integrationConnectionService');

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
 * @param {'google_ads' | 'gtm'} provider
 */
async function assertCreationDiagnosticConnection(businessId, provider) {
  const connection = await getConnectionStatus(businessId, provider, { attemptRefresh: true });

  if (OAUTH_FAILURE_REASONS.has(connection.reason)) {
    return {
      ok: false,
      errorCode: connection.reason.toUpperCase(),
      message: `OAuth not ready (${connection.reason}).`,
      connection,
    };
  }

  if (connection.reason === 'provisioning_required') {
    return {
      ok: false,
      errorCode: 'PROVISIONING_REQUIRED',
      message: `${provider} is connected but provider identifiers still need discovery or provisioning.`,
      connection,
    };
  }

  if (connection.reason === 'selection_required') {
    const target =
      provider === 'google_ads'
        ? 'Google Ads customer account'
        : 'GTM account, container, and workspace';
    return {
      ok: false,
      errorCode: 'SELECTION_REQUIRED',
      message: `Select a ${target} before running creation diagnostics.`,
      connection,
    };
  }

  if (!connection.ready) {
    return {
      ok: false,
      errorCode: 'NOT_READY',
      message: `${provider} is not ready for creation diagnostics (${connection.reason}).`,
      connection,
    };
  }

  return { ok: true, connection };
}

module.exports = { assertCreationDiagnosticConnection };
