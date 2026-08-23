'use strict';

const mongoose = require('mongoose');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { getFreshGoogleAccessToken } = require('../services/integrations/googleTokenService');
const { allScopesForProvider } = require('../constants/googleOAuth');

describe('googleTokenService', () => {
  it('returns decrypted access token when still valid', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');

    const user = await User.create({ email: 'refresh1@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('live-access'),
      refreshTokenEnc: encryptToken('live-refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: ['https://www.googleapis.com/auth/adwords'],
    });

    const token = await getFreshGoogleAccessToken({
      businessId: bc.businessId,
      provider: 'google_ads',
    });
    expect(token).toBe('live-access');
  });

  it('refreshes expired access token when refresh token exists', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');

    const user = await User.create({ email: 'refresh2@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'gtm',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('stale-access'),
      refreshTokenEnc: encryptToken('live-refresh'),
      tokenExpiryAt: new Date(Date.now() - 60_000),
      scopes: allScopesForProvider('gtm'),
    });

    const token = await getFreshGoogleAccessToken({
      businessId: bc.businessId,
      provider: 'gtm',
    });
    expect(token).toBe('mock-refreshed-access-token');

    const row = await IntegrationConnection.findOne({ businessId: bc.businessId, provider: 'gtm' })
      .select('+accessTokenEnc connectionHealth tokenExpiryAt')
      .lean();
    expect(row.connectionHealth).toBe('connected');
    expect(row.tokenExpiryAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('preserves selection_required connectionHealth after token refresh', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');

    const user = await User.create({ email: 'refresh-sel@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'selection_required',
      accessTokenEnc: encryptToken('stale-access'),
      refreshTokenEnc: encryptToken('live-refresh'),
      tokenExpiryAt: new Date(Date.now() - 60_000),
      scopes: ['https://www.googleapis.com/auth/adwords'],
    });

    await getFreshGoogleAccessToken({
      businessId: bc.businessId,
      provider: 'google_ads',
    });

    const row = await IntegrationConnection.findOne({ businessId: bc.businessId, provider: 'google_ads' })
      .select('connectionHealth')
      .lean();
    expect(row.connectionHealth).toBe('selection_required');
  });

  it('preserves provisioning_required connectionHealth after token refresh', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');

    const user = await User.create({ email: 'refresh-prov-exp@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'gtm',
      connectionHealth: 'provisioning_required',
      accessTokenEnc: encryptToken('stale-access'),
      refreshTokenEnc: encryptToken('live-refresh'),
      tokenExpiryAt: new Date(Date.now() - 60_000),
      scopes: allScopesForProvider('gtm'),
    });

    await getFreshGoogleAccessToken({
      businessId: bc.businessId,
      provider: 'gtm',
    });

    const row = await IntegrationConnection.findOne({ businessId: bc.businessId, provider: 'gtm' })
      .select('connectionHealth')
      .lean();
    expect(row.connectionHealth).toBe('provisioning_required');
  });

  it('returns access token when connection is provisioning_required but OAuth is valid', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');

    const user = await User.create({ email: 'refresh-prov@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'gtm',
      connectionHealth: 'provisioning_required',
      accessTokenEnc: encryptToken('prov-access'),
      refreshTokenEnc: encryptToken('live-refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: allScopesForProvider('gtm'),
    });

    const token = await getFreshGoogleAccessToken({
      businessId: bc.businessId,
      provider: 'gtm',
    });
    expect(token).toBe('prov-access');
  });
});
