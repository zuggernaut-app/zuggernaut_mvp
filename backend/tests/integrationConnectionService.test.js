'use strict';

const mongoose = require('mongoose');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { allScopesForProvider } = require('../constants/googleOAuth');
const {
  getConnectionStatus,
  getRequiredSetupConnections,
  assertConnectionReady,
  CONNECTION_REASON,
} = require('../services/capabilities/integrationConnectionService');

const SETUP_READY_GTM_IDS = {
  accountId: 'acc-1',
  containerId: 'cont-1',
  workspaceId: 'ws-1',
};

const SETUP_READY_ADS_IDS = {
  customerId: '1234567890',
};

describe('integrationConnectionService', () => {
  it('returns missing_connection when no row exists', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const user = await User.create({ email: 'ics1@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });

    const s = await getConnectionStatus(bc.businessId, 'gtm');
    expect(s.ready).toBe(false);
    expect(s.reason).toBe(CONNECTION_REASON.MISSING_CONNECTION);
    expect(s.nextAction).toBe('connect_gtm');
    expect(s.scopesMissing).toEqual([]);
    expect(s.identifiersMissing).toEqual(['accountId', 'containerId', 'workspaceId']);
  });

  it('returns ok when connected with tokens, scopes, and setup-ready identifiers', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const user = await User.create({ email: 'ics2@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: ['https://www.googleapis.com/auth/adwords'],
      providerIdentifiers: SETUP_READY_ADS_IDS,
    });

    const s = await getConnectionStatus(bc.businessId, 'google_ads');
    expect(s.ready).toBe(true);
    expect(s.reason).toBe(CONNECTION_REASON.OK);
    expect(s.identifiersMissing).toEqual([]);
  });

  it('returns provisioning_required when GTM connected but identifiers missing', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const user = await User.create({ email: 'ics-gtm-prov@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'gtm',
      connectionHealth: 'provisioning_required',
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: allScopesForProvider('gtm'),
      providerIdentifiers: { discoveryReason: 'GTM_PROVISIONING_REQUIRED' },
    });

    const s = await getConnectionStatus(bc.businessId, 'gtm');
    expect(s.ready).toBe(false);
    expect(s.reason).toBe(CONNECTION_REASON.PROVISIONING_REQUIRED);
    expect(s.nextAction).toBe('approve_gtm_provisioning');
    expect(s.identifiersMissing).toEqual(['accountId', 'containerId', 'workspaceId']);
  });

  it('returns provisioning_required when Google Ads missing customerId', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const user = await User.create({ email: 'ics-ads-prov@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'provisioning_required',
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: ['https://www.googleapis.com/auth/adwords'],
      providerIdentifiers: { discoveryReason: 'ADS_PROVISIONING_REQUIRED' },
    });

    const s = await getConnectionStatus(bc.businessId, 'google_ads');
    expect(s.ready).toBe(false);
    expect(s.reason).toBe(CONNECTION_REASON.PROVISIONING_REQUIRED);
    expect(s.nextAction).toBe('approve_google_ads_provisioning');
    expect(s.identifiersMissing).toEqual(['customerId']);
  });

  it('returns ok when GTM has all required identifiers', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const user = await User.create({ email: 'ics-gtm-ready@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'gtm',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: allScopesForProvider('gtm'),
      providerIdentifiers: SETUP_READY_GTM_IDS,
    });

    const s = await getConnectionStatus(bc.businessId, 'gtm');
    expect(s.ready).toBe(true);
    expect(s.reason).toBe(CONNECTION_REASON.OK);
  });

  it('returns insufficient_scopes when required scopes missing', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const user = await User.create({ email: 'ics-scope@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'gtm',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: ['https://www.googleapis.com/auth/tagmanager.edit.containers'],
      providerIdentifiers: SETUP_READY_GTM_IDS,
    });

    const s = await getConnectionStatus(bc.businessId, 'gtm');
    expect(s.ready).toBe(false);
    expect(s.reason).toBe(CONNECTION_REASON.INSUFFICIENT_SCOPES);
    expect(s.scopesMissing.length).toBeGreaterThan(0);
  });

  it('returns needs_reauth before provisioning_required when reauth is required', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const user = await User.create({ email: 'ics-reauth@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'gtm',
      connectionHealth: 'needs_reauth',
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: allScopesForProvider('gtm'),
      providerIdentifiers: {},
    });

    const s = await getConnectionStatus(bc.businessId, 'gtm');
    expect(s.ready).toBe(false);
    expect(s.reason).toBe(CONNECTION_REASON.NEEDS_REAUTH);
  });

  it('remains ready when access expired but refresh token exists and identifiers present', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const user = await User.create({ email: 'ics-exp@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('stale'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() - 60_000),
      scopes: ['https://www.googleapis.com/auth/adwords'],
      providerIdentifiers: SETUP_READY_ADS_IDS,
    });

    const s = await getConnectionStatus(bc.businessId, 'google_ads');
    expect(s.ready).toBe(true);
    expect(s.reason).toBe(CONNECTION_REASON.OK);
  });

  it('returns provisioning_required when expired token refreshable but identifiers missing', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const user = await User.create({ email: 'ics-exp-prov@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('stale'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() - 60_000),
      scopes: ['https://www.googleapis.com/auth/adwords'],
      providerIdentifiers: {},
    });

    const s = await getConnectionStatus(bc.businessId, 'google_ads');
    expect(s.ready).toBe(false);
    expect(s.reason).toBe(CONNECTION_REASON.PROVISIONING_REQUIRED);
  });

  it('GBP remains ready without identifiers when OAuth is valid', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const user = await User.create({ email: 'ics-gbp@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'gbp',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: ['https://www.googleapis.com/auth/business.manage'],
      providerIdentifiers: { discoveryReason: 'GBP_NO_ACCOUNTS' },
    });

    const s = await getConnectionStatus(bc.businessId, 'gbp');
    expect(s.ready).toBe(true);
    expect(s.reason).toBe(CONNECTION_REASON.OK);
  });

  it('getRequiredSetupConnections lists missing gtm and google_ads', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const user = await User.create({ email: 'ics3@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });

    const { missing, allReady } = await getRequiredSetupConnections(bc.businessId);
    expect(allReady).toBe(false);
    expect(missing).toEqual(expect.arrayContaining(['gtm', 'google_ads']));
  });

  it('getRequiredSetupConnections reports allReady when GTM and Ads are setup-ready', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const user = await User.create({ email: 'ics-all-ready@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    const token = encryptToken('token');
    const refresh = encryptToken('refresh');
    const expiry = new Date(Date.now() + 3600_000);

    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'gtm',
      connectionHealth: 'connected',
      accessTokenEnc: token,
      refreshTokenEnc: refresh,
      tokenExpiryAt: expiry,
      scopes: allScopesForProvider('gtm'),
      providerIdentifiers: SETUP_READY_GTM_IDS,
    });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      accessTokenEnc: token,
      refreshTokenEnc: refresh,
      tokenExpiryAt: expiry,
      scopes: ['https://www.googleapis.com/auth/adwords'],
      providerIdentifiers: SETUP_READY_ADS_IDS,
    });

    const { missing, allReady } = await getRequiredSetupConnections(bc.businessId);
    expect(allReady).toBe(true);
    expect(missing).toEqual([]);
  });

  it('assertConnectionReady throws provisioning hint when identifiers missing', () => {
    expect(() =>
      assertConnectionReady({
        ready: false,
        reason: CONNECTION_REASON.PROVISIONING_REQUIRED,
        provider: 'gtm',
      })
    ).toThrow(/Approve provisioning for gtm/);
  });
});
