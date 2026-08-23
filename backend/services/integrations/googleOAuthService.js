'use strict';

const jwt = require('jsonwebtoken');
const axios = require('axios');
const mongoose = require('mongoose');
const {
  GOOGLE_OAUTH_ENDPOINTS,
  allScopesForProvider,
  validateGrantedScopes,
  getGoogleProviderOAuthConfig,
  isGoogleOAuthProvider,
} = require('../../constants/googleOAuth');
const { encryptToken } = require('../../lib/crypto/tokenEncryption');
const { PROVIDERS } = require('../../constants/enums');
const { discoverProviderConnection } = require('./providerDiscoveryService');
const { mergeRediscoveryWithSavedSelection } = require('./providerDiscoveryResult');
const {
  assertProviderResourceExclusive,
} = require('../../lib/providerResourceExclusivity');
const { getFreshGoogleAccessToken } = require('./googleTokenService');
const IntegrationConnection = mongoose.model('IntegrationConnection');

const OAUTH_STATE_PURPOSE = 'google_oauth_connect';
const OAUTH_STATE_TTL_SEC = 600;

function getGoogleClientId() {
  const id = process.env.GOOGLE_CLIENT_ID?.trim();
  if (!id) throw new Error('GOOGLE_CLIENT_ID must be set');
  return id;
}

function getGoogleClientSecret() {
  const secret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!secret) throw new Error('GOOGLE_CLIENT_SECRET must be set');
  return secret;
}

function getOAuthRedirectUri() {
  const explicit = process.env.GOOGLE_OAUTH_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  const base = process.env.API_PUBLIC_BASE_URL?.trim() || 'http://localhost:3000';
  return `${base.replace(/\/+$/, '')}/api/v1/integrations/google/callback`;
}

function getFrontendRedirectBase() {
  const origin = process.env.FRONTEND_ORIGIN?.trim()?.split(',')[0]?.trim();
  return origin || 'http://localhost:5173';
}

/**
 * @param {{ businessId: string, provider: string, userId: string, returnPath?: string }} payload
 */
function signOAuthState({ businessId, provider, userId, returnPath }) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set for OAuth state signing');
  }
  const claims = { purpose: OAUTH_STATE_PURPOSE, businessId, provider, userId };
  if (typeof returnPath === 'string' && returnPath.trim().startsWith('/')) {
    claims.returnPath = returnPath.trim();
  }
  return jwt.sign(claims, secret, { expiresIn: OAUTH_STATE_TTL_SEC, algorithm: 'HS256' });
}

/**
 * @param {string} state
 */
function verifyOAuthState(state) {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;
  try {
    const payload = jwt.verify(state, secret, { algorithms: ['HS256'] });
    if (
      !payload ||
      typeof payload !== 'object' ||
      payload.purpose !== OAUTH_STATE_PURPOSE ||
      typeof payload.businessId !== 'string' ||
      typeof payload.provider !== 'string' ||
      typeof payload.userId !== 'string'
    ) {
      return null;
    }
    const returnPath =
      typeof payload.returnPath === 'string' && payload.returnPath.startsWith('/')
        ? payload.returnPath
        : undefined;
    return { ...payload, returnPath };
  } catch {
    return null;
  }
}

/**
 * @param {{ businessId: string, provider: string, userId: string, returnPath?: string }} input
 */
function buildGoogleConnectUrl(input) {
  const { businessId, provider, userId, returnPath } = input;
  if (!isGoogleOAuthProvider(provider)) {
    throw new Error(`Unsupported Google OAuth provider: ${provider}`);
  }
  const scopes = allScopesForProvider(provider);
  const state = signOAuthState({ businessId, provider, userId, returnPath });
  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    redirect_uri: getOAuthRedirectUri(),
    response_type: 'code',
    scope: scopes.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
    include_granted_scopes: 'true',
  });
  return `${GOOGLE_OAUTH_ENDPOINTS.authorize}?${params.toString()}`;
}

/**
 * @param {string} code
 */
async function exchangeAuthorizationCode(code, provider) {
  if (process.env.GOOGLE_OAUTH_MOCK === 'true') {
    return {
      access_token: 'mock-access-token',
      refresh_token: 'mock-refresh-token',
      expires_in: 3600,
      scope: allScopesForProvider(provider).join(' '),
      token_type: 'Bearer',
    };
  }

  const res = await axios.post(
    GOOGLE_OAUTH_ENDPOINTS.token,
    new URLSearchParams({
      code,
      client_id: getGoogleClientId(),
      client_secret: getGoogleClientSecret(),
      redirect_uri: getOAuthRedirectUri(),
      grant_type: 'authorization_code',
    }).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
      validateStatus: () => true,
    }
  );

  if (res.status < 200 || res.status >= 300 || !res.data?.access_token) {
    const detail =
      typeof res.data?.error_description === 'string'
        ? res.data.error_description
        : typeof res.data?.error === 'string'
          ? res.data.error
          : 'Token exchange failed';
    const err = new Error(detail);
    err.code = 'OAUTH_TOKEN_EXCHANGE_FAILED';
    throw err;
  }

  return res.data;
}

/**
 * @param {string} scopeString
 */
function parseScopeString(scopeString) {
  if (typeof scopeString !== 'string' || !scopeString.trim()) return [];
  return scopeString.trim().split(/\s+/).filter(Boolean);
}

/**
 * @param {string} provider
 * @param {string} accessToken
 */
async function fetchProviderIdentifiers(provider, accessToken) {
  const discovery = await discoverProviderConnection(provider, accessToken);
  return discovery.providerIdentifiers;
}

/**
 * @param {{ businessId: string, provider: string, userId: string, code: string }} input
 */
async function completeGoogleOAuthCallback(input) {
  const { businessId, provider, code } = input;
  if (!isGoogleOAuthProvider(provider)) {
    const err = new Error(`Unsupported provider: ${provider}`);
    err.code = 'UNSUPPORTED_PROVIDER';
    throw err;
  }

  const tokenRes = await exchangeAuthorizationCode(code, provider);
  let grantedScopes = parseScopeString(tokenRes.scope);
  // Google often omits `scope` on the token response even when consent succeeded.
  if (grantedScopes.length === 0) {
    grantedScopes = allScopesForProvider(provider);
  }
  const scopeCheck = validateGrantedScopes(provider, grantedScopes);
  if (!scopeCheck.ok) {
    const err = new Error(`Missing required scopes: ${scopeCheck.missing.join(', ')}`);
    err.code = 'INSUFFICIENT_SCOPES';
    err.missingScopes = scopeCheck.missing;
    throw err;
  }

  const accessTokenEnc = encryptToken(tokenRes.access_token);
  const refreshTokenEnc = tokenRes.refresh_token ? encryptToken(tokenRes.refresh_token) : undefined;
  const expiresIn = Number(tokenRes.expires_in) || 3600;
  const tokenExpiryAt = new Date(Date.now() + expiresIn * 1000);

  const discovery = await discoverProviderConnection(provider, tokenRes.access_token);
  const { providerIdentifiers, connectionHealth, reason: discoveryReason } = discovery;

  const cfg = getGoogleProviderOAuthConfig(provider);

  const prior = await IntegrationConnection.findOne({ businessId, provider })
    .select('providerIdentifiers')
    .lean();

  const gbpLocationLocked =
    provider === 'gbp' && Boolean(prior?.providerIdentifiers?.locationName);

  if (
    provider === 'gbp' &&
    !gbpLocationLocked &&
    providerIdentifiers?.locationName
  ) {
    await assertProviderResourceExclusive(
      businessId,
      'gbp',
      'locationName',
      providerIdentifiers.locationName
    );
  }

  const tokenFields = {
    businessId,
    provider,
    connectionHealth,
    scopes: grantedScopes,
    tokenExpiryAt,
    accessTokenEnc,
    ...(refreshTokenEnc ? { refreshTokenEnc } : {}),
  };

  if (gbpLocationLocked) {
    await IntegrationConnection.findOneAndUpdate(
      { businessId, provider },
      { $set: tokenFields },
      { upsert: true, setDefaultsOnInsert: true }
    );
  } else {
    await IntegrationConnection.findOneAndUpdate(
      { businessId, provider },
      {
        $set: {
          ...tokenFields,
          providerIdentifiers,
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }

  const responseIdentifiers = gbpLocationLocked
    ? prior?.providerIdentifiers ?? providerIdentifiers
    : providerIdentifiers;

  return {
    provider,
    displayName: cfg?.displayName ?? provider,
    scopes: grantedScopes,
    tokenExpiryAt,
    providerIdentifiers: responseIdentifiers,
    connectionHealth,
    discoveryReason,
  };
}

/**
 * Re-run read-only discovery for OAuth-connected providers (e.g. after manual GTM account creation).
 *
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {readonly string[]} [providers]
 */
async function rediscoverConnectedIntegrations(businessId, providers = PROVIDERS) {
  const updated = [];

  for (const provider of providers) {
    const row = await IntegrationConnection.findOne({ businessId, provider })
      .select('+accessTokenEnc +refreshTokenEnc connectionHealth providerIdentifiers')
      .lean();

    if (!row) continue;
    if (row.connectionHealth === 'needs_reauth') continue;
    if (!row.accessTokenEnc && !row.refreshTokenEnc) continue;

    try {
      const accessToken = await getFreshGoogleAccessToken({ businessId, provider });
      const discovery = await discoverProviderConnection(provider, accessToken);
      const merged = mergeRediscoveryWithSavedSelection(
        provider,
        row.providerIdentifiers,
        discovery
      );
      await IntegrationConnection.findOneAndUpdate(
        { businessId, provider },
        {
          $set: {
            connectionHealth: merged.connectionHealth,
            providerIdentifiers: merged.providerIdentifiers,
          },
        }
      );
      updated.push(provider);
    } catch {
      // Keep the last known connection state when discovery cannot run.
    }
  }

  return updated;
}

function buildFrontendRedirectUrl({ provider, outcome, reason, returnPath }) {
  const base = getFrontendRedirectBase().replace(/\/+$/, '');
  const path =
    typeof returnPath === 'string' && returnPath.startsWith('/') ? returnPath : '/setup';
  const params = new URLSearchParams({ integration: outcome, provider });
  if (reason) params.set('reason', reason);
  return `${base}${path}?${params.toString()}`;
}

module.exports = {
  OAUTH_STATE_PURPOSE,
  signOAuthState,
  verifyOAuthState,
  buildGoogleConnectUrl,
  exchangeAuthorizationCode,
  completeGoogleOAuthCallback,
  buildFrontendRedirectUrl,
  parseScopeString,
  getOAuthRedirectUri,
  fetchProviderIdentifiers,
  rediscoverConnectedIntegrations,
};
