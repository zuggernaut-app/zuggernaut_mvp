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
const { discoverProviderConnection } = require('./providerDiscoveryService');
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
 * @param {{ businessId: string, provider: string, userId: string }} payload
 */
function signOAuthState({ businessId, provider, userId }) {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be set for OAuth state signing');
  }
  return jwt.sign(
    { purpose: OAUTH_STATE_PURPOSE, businessId, provider, userId },
    secret,
    { expiresIn: OAUTH_STATE_TTL_SEC, algorithm: 'HS256' }
  );
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
    return payload;
  } catch {
    return null;
  }
}

/**
 * @param {{ businessId: string, provider: string, userId: string }} input
 */
function buildGoogleConnectUrl(input) {
  const { businessId, provider, userId } = input;
  if (!isGoogleOAuthProvider(provider)) {
    throw new Error(`Unsupported Google OAuth provider: ${provider}`);
  }
  const scopes = allScopesForProvider(provider);
  const state = signOAuthState({ businessId, provider, userId });
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
  const grantedScopes = parseScopeString(tokenRes.scope);
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

  await IntegrationConnection.findOneAndUpdate(
    { businessId, provider },
    {
      $set: {
        businessId,
        provider,
        connectionHealth,
        scopes: grantedScopes,
        tokenExpiryAt,
        accessTokenEnc,
        ...(refreshTokenEnc ? { refreshTokenEnc } : {}),
        providerIdentifiers,
      },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  return {
    provider,
    displayName: cfg?.displayName ?? provider,
    scopes: grantedScopes,
    tokenExpiryAt,
    providerIdentifiers,
    connectionHealth,
    discoveryReason,
  };
}

function buildFrontendRedirectUrl({ provider, outcome, reason }) {
  const base = getFrontendRedirectBase().replace(/\/+$/, '');
  const params = new URLSearchParams({ integration: outcome, provider });
  if (reason) params.set('reason', reason);
  return `${base}/setup?${params.toString()}`;
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
};
