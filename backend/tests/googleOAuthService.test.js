'use strict';

const mongoose = require('mongoose');
const {
  buildGoogleConnectUrl,
  signOAuthState,
  verifyOAuthState,
  completeGoogleOAuthCallback,
  parseScopeString,
} = require('../services/integrations/googleOAuthService');
const { validateGrantedScopes, allScopesForProvider } = require('../constants/googleOAuth');
const { decryptToken } = require('../lib/crypto/tokenEncryption');

describe('googleOAuthService', () => {
  it('buildGoogleConnectUrl includes client_id and state', () => {
    const url = buildGoogleConnectUrl({
      businessId: '507f1f77bcf86cd799439011',
      provider: 'gtm',
      userId: '507f1f77bcf86cd799439012',
    });
    expect(url).toContain('accounts.google.com');
    expect(url).toContain('client_id=');
    expect(url).toContain('state=');
    expect(url).toContain('tagmanager');
    expect(url).toContain(encodeURIComponent('https://www.googleapis.com/auth/tagmanager.manage.accounts'));
  });

  it('verifyOAuthState round-trips signed state', () => {
    const state = signOAuthState({
      businessId: '507f1f77bcf86cd799439011',
      provider: 'google_ads',
      userId: '507f1f77bcf86cd799439012',
    });
    const payload = verifyOAuthState(state);
    expect(payload?.businessId).toBe('507f1f77bcf86cd799439011');
    expect(payload?.provider).toBe('google_ads');
  });

  it('validateGrantedScopes detects missing scopes', () => {
    const check = validateGrantedScopes('gtm', ['https://www.googleapis.com/auth/tagmanager.edit.containers']);
    expect(check.ok).toBe(false);
    expect(check.missing).toEqual(
      expect.arrayContaining([
        'https://www.googleapis.com/auth/tagmanager.publish',
        'https://www.googleapis.com/auth/tagmanager.manage.accounts',
      ])
    );
  });

  it('validateGrantedScopes passes when all GTM required scopes granted', () => {
    const check = validateGrantedScopes('gtm', allScopesForProvider('gtm'));
    expect(check.ok).toBe(true);
    expect(check.missing).toEqual([]);
  });

  it('completeGoogleOAuthCallback persists encrypted tokens', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');

    const user = await User.create({ email: 'oauth@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });

    await completeGoogleOAuthCallback({
      businessId: bc.businessId.toString(),
      provider: 'gtm',
      userId: user._id.toString(),
      code: 'mock-auth-code',
    });

    const row = await IntegrationConnection.findOne({ businessId: bc.businessId, provider: 'gtm' })
      .select('+accessTokenEnc +refreshTokenEnc scopes connectionHealth providerIdentifiers')
      .lean();

    expect(row.connectionHealth).toBe('connected');
    expect(row.scopes?.length).toBeGreaterThan(0);
    expect(row.accessTokenEnc).toBeTruthy();
    expect(row.refreshTokenEnc).toBeTruthy();
    expect(decryptToken(row.accessTokenEnc)).toBe('mock-access-token');
    expect(row.providerIdentifiers?.containerId).toBe('mock-container');
    expect(row.providerIdentifiers?.accountId).toBe('mock-account');
  });

  it('parseScopeString splits scope strings', () => {
    expect(parseScopeString('a b c')).toEqual(['a', 'b', 'c']);
  });
});
