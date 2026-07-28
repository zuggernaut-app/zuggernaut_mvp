'use strict';

const axios = require('axios');
const mongoose = require('mongoose');
const { withProviderRateLimit } = require('../../lib/providerRateLimit');
const { GOOGLE_OAUTH_ENDPOINTS } = require('../../constants/googleOAuth');
const { encryptToken, decryptToken } = require('../../lib/crypto/tokenEncryption');
const { getMccGoogleAdsRefreshToken } = require('./googleAdsApiConfig');

const IntegrationConnection = mongoose.model('IntegrationConnection');

const REFRESH_BUFFER_MS = 5 * 60 * 1000;

function getGoogleClientId() {
  return process.env.GOOGLE_CLIENT_ID?.trim();
}

function getGoogleClientSecret() {
  return process.env.GOOGLE_CLIENT_SECRET?.trim();
}

/**
 * @param {string} refreshToken
 */
async function refreshGoogleAccessToken(refreshToken) {
  if (process.env.GOOGLE_OAUTH_MOCK === 'true') {
    return {
      access_token: 'mock-refreshed-access-token',
      expires_in: 3600,
      token_type: 'Bearer',
    };
  }

  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();
  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set for token refresh');
  }

  const res = await axios.post(
    GOOGLE_OAUTH_ENDPOINTS.token,
    new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
    {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 15000,
      validateStatus: () => true,
    }
  );

  if (res.status < 200 || res.status >= 300 || !res.data?.access_token) {
    const err = new Error('Google token refresh failed');
    err.code = 'TOKEN_REFRESH_FAILED';
    throw err;
  }

  return res.data;
}

/**
 * Returns a usable plaintext access token; refreshes and persists when needed.
 * @param {{ businessId: import('mongoose').Types.ObjectId | string, provider: string }} input
 * @returns {Promise<string>}
 */
async function getFreshGoogleAccessToken({ businessId, provider }) {
  const row = await IntegrationConnection.findOne({ businessId, provider })
    .select('+accessTokenEnc +refreshTokenEnc scopes tokenExpiryAt connectionHealth')
    .exec();

  if (!row) {
    const err = new Error(`No IntegrationConnection for provider ${provider}`);
    err.code = 'MISSING_CONNECTION';
    throw err;
  }

  const oauthHealthy =
    row.connectionHealth === 'connected' ||
    row.connectionHealth === 'provisioning_required' ||
    row.connectionHealth === 'selection_required';
  if (!oauthHealthy) {
    const err = new Error(`Provider ${provider} is not connected`);
    err.code = 'NOT_CONNECTED';
    throw err;
  }

  const now = Date.now();
  const expiresAt = row.tokenExpiryAt ? row.tokenExpiryAt.getTime() : 0;
  const accessStillValid =
    row.accessTokenEnc && expiresAt > now + REFRESH_BUFFER_MS;

  if (accessStillValid) {
    return decryptToken(row.accessTokenEnc);
  }

  if (!row.refreshTokenEnc) {
    row.connectionHealth = 'needs_reauth';
    await row.save();
    const err = new Error(`Access token expired and no refresh token for ${provider}`);
    err.code = 'NEEDS_REAUTH';
    throw err;
  }

  const refreshPlain = decryptToken(row.refreshTokenEnc);
  let refreshed;
  try {
    refreshed = await withProviderRateLimit('google_oauth', () => refreshGoogleAccessToken(refreshPlain));
  } catch (err) {
    row.connectionHealth = 'needs_reauth';
    await row.save();
    throw err;
  }

  const expiresIn = Number(refreshed.expires_in) || 3600;
  row.accessTokenEnc = encryptToken(refreshed.access_token);
  row.tokenExpiryAt = new Date(Date.now() + expiresIn * 1000);
  row.connectionHealth = 'connected';
  await row.save();

  return refreshed.access_token;
}

/**
 * Platform-level MCC admin access token for manager-side Google Ads API calls (invite only).
 * Uses GOOGLE_ADS_MCC_REFRESH_TOKEN from server secrets — not tenant IntegrationConnection.
 *
 * @returns {Promise<string>}
 */
async function getMccGoogleAdsAccessToken() {
  if (process.env.GOOGLE_OAUTH_MOCK === 'true') {
    return 'mock-mcc-access-token';
  }

  const refreshToken = getMccGoogleAdsRefreshToken({ required: true });
  const refreshed = await withProviderRateLimit('google_oauth', () =>
    refreshGoogleAccessToken(refreshToken)
  );
  return refreshed.access_token;
}

module.exports = {
  REFRESH_BUFFER_MS,
  refreshGoogleAccessToken,
  getFreshGoogleAccessToken,
  getMccGoogleAdsAccessToken,
};
