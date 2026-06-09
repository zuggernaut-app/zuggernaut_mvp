'use strict';

const { mongoose } = require('../../shared');
const {
  listGbpAccounts,
  listGbpLocations,
  fetchGbpProfileReadModel,
} = require('../../../../backend/services/integrations/gbpProfileReadClient');
const { getFreshGoogleAccessToken } = require('../../../../backend/services/integrations/googleTokenService');
const { getOAuthRedirectUri } = require('../../../../backend/services/integrations/googleOAuthService');
const { allScopesForProvider } = require('../../../../backend/constants/googleOAuth');
const {
  stage,
  traceTokenCrypto,
  traceBusinessContext,
  traceStoredConnection,
  traceConnectionStatus,
  traceTokenRefresh,
  traceConnectUrl,
  buildOAuthTraceReport,
  finalizeStagedReport,
} = require('./oauthLabShared');

const IntegrationConnection = mongoose.model('IntegrationConnection');

const PROVIDER = 'gbp';
const RETURN_PATH = '/dev/integrations/gbp';

function traceEnvironment(env = process.env) {
  const issues = [];
  if (!env.GOOGLE_CLIENT_ID?.trim()) issues.push('GOOGLE_CLIENT_ID missing');
  if (!env.GOOGLE_CLIENT_SECRET?.trim()) issues.push('GOOGLE_CLIENT_SECRET missing');
  if (!env.JWT_SECRET || env.JWT_SECRET.length < 32) issues.push('JWT_SECRET missing or too short');
  if (!env.TOKEN_ENCRYPTION_KEY?.trim()) issues.push('TOKEN_ENCRYPTION_KEY missing');
  if (env.GBP_API_ENABLED !== 'true') issues.push('GBP_API_ENABLED is not true');

  return stage('Environment', issues.length === 0, {
    id: 'environment',
    detail: issues.length ? issues.join('; ') : 'Required env vars present',
    data: {
      gbpApiEnabled: env.GBP_API_ENABLED === 'true',
      gbpApiMock: env.GBP_API_MOCK === 'true',
      oauthRedirectUri: getOAuthRedirectUri(),
      requiredScopes: allScopesForProvider(PROVIDER),
    },
    hint:
      issues.length > 0
        ? 'Fix backend/.env and restart the API before OAuth or API tests.'
        : undefined,
  });
}

/**
 * @param {string} businessId
 */
async function traceListGbpAccounts(businessId) {
  const conn = await IntegrationConnection.findOne({ businessId, provider: PROVIDER })
    .select('+accessTokenEnc')
    .lean();

  if (!conn?.accessTokenEnc) {
    return stage('List GBP accounts', false, {
      id: 'list_gbp_accounts',
      detail: 'Skipped — no stored access token',
      skipped: true,
    });
  }

  try {
    const accessToken = await getFreshGoogleAccessToken({ businessId, provider: PROVIDER });
    const accounts = await listGbpAccounts(accessToken);
    return stage('List GBP accounts', true, {
      id: 'list_gbp_accounts',
      detail: `Found ${accounts.length} GBP account(s)`,
      data: {
        accountCount: accounts.length,
        accounts: accounts.slice(0, 10).map((row) => ({
          name: row.name ?? null,
          accountName: row.accountName ?? null,
        })),
      },
      hint:
        accounts.length === 0
          ? 'No Business Profile accounts for this Google user — create or claim a profile first.'
          : 'Run read tests to fetch location profile details.',
    });
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : 'GBP_LIST_FAILED';
    return stage('List GBP accounts', false, {
      id: 'list_gbp_accounts',
      detail: `${code}: ${err instanceof Error ? err.message : 'listGbpAccounts failed'}`,
      hint: 'Check OAuth scope includes business.manage and GBP API is enabled.',
    });
  }
}

/**
 * @param {string} businessId
 * @param {string} userId
 */
async function runOAuthTrace(businessId, userId) {
  const stages = [];
  let connectUrl = null;

  stages.push(traceEnvironment());
  stages.push(traceTokenCrypto());

  const bcStage = await traceBusinessContext(businessId);
  stages.push(bcStage);
  if (!bcStage.ok) {
    return buildOAuthTraceReport({ businessId, userId, stages, connectUrl }, PROVIDER, RETURN_PATH);
  }

  const resolvedUserId = userId || String(bcStage.data?.userId || '');
  const connectStage = await traceConnectUrl(businessId, resolvedUserId, PROVIDER, RETURN_PATH);
  connectUrl = connectStage._connectUrl ?? null;
  const { _connectUrl, ...connectPublic } = connectStage;
  stages.push(connectPublic);

  stages.push(
    await traceStoredConnection(businessId, PROVIDER, (conn) => ({
      discoveryReason: conn.providerIdentifiers?.discoveryReason ?? null,
      accountName: conn.providerIdentifiers?.accountName ?? null,
      locationName: conn.providerIdentifiers?.locationName ?? null,
    })),
  );
  stages.push(await traceConnectionStatus(businessId, PROVIDER));
  stages.push(await traceTokenRefresh(businessId, PROVIDER));
  stages.push(await traceListGbpAccounts(businessId));

  return buildOAuthTraceReport({ businessId, userId: resolvedUserId, stages, connectUrl }, PROVIDER, RETURN_PATH);
}

/**
 * @param {string} businessId
 * @param {{ locationName?: string, accountName?: string }} [options]
 */
async function runReadTests(businessId, options = {}) {
  const startedAt = new Date().toISOString();
  const stages = [];

  stages.push(traceEnvironment());
  stages.push(
    await traceStoredConnection(businessId, PROVIDER, (conn) => ({
      accountName: conn.providerIdentifiers?.accountName ?? null,
      locationName: conn.providerIdentifiers?.locationName ?? null,
    })),
  );

  const conn = await IntegrationConnection.findOne({ businessId, provider: PROVIDER })
    .select('+accessTokenEnc providerIdentifiers')
    .lean();

  if (!conn?.accessTokenEnc) {
    return finalizeStagedReport({
      provider: PROVIDER,
      businessId,
      startedAt,
      stages,
      message: 'Connect GBP OAuth for this businessId before read tests.',
      ok: false,
      extra: { mode: 'read', locationReady: false },
    });
  }

  let accessToken;
  try {
    accessToken = await getFreshGoogleAccessToken({ businessId, provider: PROVIDER });
    stages.push(
      stage('Token refresh', true, {
        id: 'token_refresh',
        detail: 'Access token ready for GBP API calls',
      }),
    );
  } catch (err) {
    const refreshStage = stage('Token refresh', false, {
      id: 'token_refresh',
      detail: err instanceof Error ? err.message : 'Token refresh failed',
    });
    stages.push(refreshStage);
    return finalizeStagedReport({
      provider: PROVIDER,
      businessId,
      startedAt,
      stages,
      message: refreshStage.detail,
      ok: false,
      extra: { mode: 'read', locationReady: false },
    });
  }

  let accountName = options.accountName ?? conn.providerIdentifiers?.accountName ?? null;
  let locationName = options.locationName ?? conn.providerIdentifiers?.locationName ?? null;
  const useStoredLocation = Boolean(accountName && locationName);

  try {
    if (useStoredLocation) {
      stages.push(
        stage('Read GBP accounts', true, {
          id: 'read_gbp_accounts',
          skipped: true,
          detail: 'Skipped — using stored account/location from connection',
          data: { accountName, locationName },
        }),
      );
      stages.push(
        stage('Read GBP locations', true, {
          id: 'read_gbp_locations',
          skipped: true,
          detail: 'Skipped — using stored location from connection',
          data: { accountName, locationName },
        }),
      );
    } else {
    const accounts = await listGbpAccounts(accessToken);
    stages.push(
      stage('Read GBP accounts', true, {
        id: 'read_gbp_accounts',
        detail: `Found ${accounts.length} account(s)`,
        data: {
          accountCount: accounts.length,
          accounts: accounts.slice(0, 5).map((row) => ({
            name: row.name ?? null,
            accountName: row.accountName ?? null,
          })),
        },
      }),
    );

    if (!accountName && accounts[0]?.name) {
      accountName = accounts[0].name;
    }

    if (accountName) {
      const locations = await listGbpLocations(accessToken, accountName);
      stages.push(
        stage('Read GBP locations', true, {
          id: 'read_gbp_locations',
          detail: `Found ${locations.length} location(s) for ${accountName}`,
          data: {
            accountName,
            locationCount: locations.length,
            locations: locations.slice(0, 10).map((row) => ({
              name: row.name ?? null,
              title: row.title ?? null,
            })),
          },
        }),
      );

      if (!locationName && locations[0]?.name) {
        locationName = locations[0].name;
      }
    } else {
      stages.push(
        stage('Read GBP locations', false, {
          id: 'read_gbp_locations',
          skipped: true,
          detail: 'Skipped — no GBP account to list locations from',
        }),
      );
    }
    }
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : 'GBP_READ_FAILED';
    stages.push(
      stage('Read GBP accounts', false, {
        id: 'read_gbp_accounts',
        detail: `${code}: ${err instanceof Error ? err.message : String(err)}`,
      }),
    );
    return finalizeStagedReport({
      provider: PROVIDER,
      businessId,
      startedAt,
      stages,
      message: 'GBP account/location read failed.',
      ok: false,
      extra: { mode: 'read', locationReady: false },
    });
  }

  if (!locationName) {
    const missingStage = stage('Resolve GBP location', false, {
      id: 'resolve_gbp_location',
      detail: 'No GBP location available for profile read',
      hint: 'Claim or create a Business Profile location for this Google account.',
    });
    stages.push(missingStage);
    return finalizeStagedReport({
      provider: PROVIDER,
      businessId,
      startedAt,
      stages,
      message: missingStage.detail,
      ok: false,
      extra: { mode: 'read', locationReady: false },
    });
  }

  stages.push(
    stage('Resolve GBP location', true, {
      id: 'resolve_gbp_location',
      detail: `Using location ${locationName}`,
      data: { accountName, locationName },
    }),
  );

  try {
    const readModel = await fetchGbpProfileReadModel({ businessId });
    stages.push(
      stage('Read GBP profile', true, {
        id: 'read_gbp_profile',
        detail: `Profile read via ${readModel.source}`,
        data: {
          locationName: readModel.locationName,
          profile: readModel.profile,
          recordedAt: readModel.recordedAt,
        },
      }),
    );
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : 'GBP_PROFILE_READ_FAILED';
    stages.push(
      stage('Read GBP profile', false, {
        id: 'read_gbp_profile',
        detail: `${code}: ${err instanceof Error ? err.message : String(err)}`,
        hint:
          code === 'GBP_NO_ACCOUNTS' || code === 'GBP_NO_LOCATIONS'
            ? 'Create or claim a Business Profile before running read tests.'
            : 'GBP is read-only in V1 — no write tests are available.',
      }),
    );
  }

  return finalizeStagedReport({
    provider: PROVIDER,
    businessId,
    startedAt,
    stages,
    message: 'GBP read test run completed.',
    extra: { mode: 'read', locationReady: true, locationName },
  });
}

module.exports = {
  PROVIDER,
  RETURN_PATH,
  runOAuthTrace,
  runReadTests,
};
