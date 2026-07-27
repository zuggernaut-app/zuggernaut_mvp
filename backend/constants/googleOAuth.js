'use strict';

const { PROVIDERS } = require('./enums');

/** Google OAuth scope sets per V1 provider — single source of truth. */
const GOOGLE_PROVIDER_OAUTH = Object.freeze({
  gbp: Object.freeze({
    provider: 'gbp',
    displayName: 'Google Business Profile',
    requiredScopes: Object.freeze(['https://www.googleapis.com/auth/business.manage']),
    optionalScopes: Object.freeze([]),
    callbackKey: 'gbp',
  }),
  gtm: Object.freeze({
    provider: 'gtm',
    displayName: 'Google Tag Manager',
    requiredScopes: Object.freeze([
      'https://www.googleapis.com/auth/tagmanager.edit.containers',
      'https://www.googleapis.com/auth/tagmanager.edit.containerversions',
      'https://www.googleapis.com/auth/tagmanager.publish',
      'https://www.googleapis.com/auth/tagmanager.manage.accounts',
    ]),
    optionalScopes: Object.freeze([]),
    callbackKey: 'gtm',
  }),
  google_ads: Object.freeze({
    provider: 'google_ads',
    displayName: 'Google Ads',
    requiredScopes: Object.freeze(['https://www.googleapis.com/auth/adwords']),
    optionalScopes: Object.freeze([]),
    callbackKey: 'google_ads',
  }),
});

const GOOGLE_OAUTH_ENDPOINTS = Object.freeze({
  authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
  token: 'https://oauth2.googleapis.com/token',
});

function getGoogleProviderOAuthConfig(provider) {
  return GOOGLE_PROVIDER_OAUTH[provider] ?? null;
}

function isGoogleOAuthProvider(provider) {
  return PROVIDERS.includes(provider) && Boolean(GOOGLE_PROVIDER_OAUTH[provider]);
}

/**
 * @param {string} provider
 * @returns {string[]}
 */
function allScopesForProvider(provider) {
  const cfg = getGoogleProviderOAuthConfig(provider);
  if (!cfg) return [];
  return [...cfg.requiredScopes, ...cfg.optionalScopes];
}

/**
 * @param {string} provider
 * @param {string[]} grantedScopes
 */
function validateGrantedScopes(provider, grantedScopes) {
  const cfg = getGoogleProviderOAuthConfig(provider);
  if (!cfg) {
    return { ok: false, missing: [], granted: grantedScopes };
  }
  const grantedSet = new Set(grantedScopes);
  const missing = cfg.requiredScopes.filter((s) => !grantedSet.has(s));
  return { ok: missing.length === 0, missing, granted: grantedScopes };
}

module.exports = {
  GOOGLE_PROVIDER_OAUTH,
  GOOGLE_OAUTH_ENDPOINTS,
  getGoogleProviderOAuthConfig,
  isGoogleOAuthProvider,
  allScopesForProvider,
  validateGrantedScopes,
};
