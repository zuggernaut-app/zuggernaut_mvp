'use strict';

const mongoose = require('mongoose');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const {
  ensureMccLinkInvited,
  refreshMccLinkStatus,
  assertMccLinkReadyForSetup,
} = require('../services/capabilities/googleAdsMccLinkService');
const { allScopesForProvider } = require('../constants/googleOAuth');

describe('googleAdsMccLinkService integration', () => {
  const managerId = '3462198684';
  const clientId = '1234567890';

  beforeEach(() => {
    process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID = managerId;
    process.env.GOOGLE_ADS_API_MOCK = 'true';
    process.env.GOOGLE_OAUTH_MOCK = 'true';
    process.env.GOOGLE_ADS_MCC_REFRESH_TOKEN = 'mock-mcc-refresh';
  });

  async function seedGoogleAdsConnection(mccLink = null) {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const user = await User.create({ email: `mcc-${Date.now()}@test.com` });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: allScopesForProvider('google_ads'),
      providerIdentifiers: {
        customerId: clientId,
        loginCustomerId: managerId,
        managerCustomerId: managerId,
        ...(mccLink ? { mccLink } : {}),
      },
    });
    return bc.businessId;
  }

  it('refreshMccLinkStatus persists ACTIVE in mock mode', async () => {
    const businessId = await seedGoogleAdsConnection();
    const { mccLink } = await refreshMccLinkStatus(businessId);
    expect(mccLink.status).toBe('ACTIVE');
    expect(mccLink.clientCustomerId).toBe(clientId);
    expect(mccLink.managerCustomerId).toBe(managerId);
  });

  it('ensureMccLinkInvited does not create duplicate invite when already active', async () => {
    const businessId = await seedGoogleAdsConnection({
      status: 'ACTIVE',
      managerCustomerId: managerId,
      clientCustomerId: clientId,
    });
    const result = await ensureMccLinkInvited(businessId);
    expect(result.outcome).toBe('active');
  });

  it('assertMccLinkReadyForSetup passes when link is active', async () => {
    const businessId = await seedGoogleAdsConnection({
      status: 'ACTIVE',
      managerCustomerId: managerId,
      clientCustomerId: clientId,
    });
    await expect(assertMccLinkReadyForSetup(businessId, { refresh: false })).resolves.toMatchObject({
      status: 'ACTIVE',
    });
  });

  it('assertMccLinkReadyForSetup rejects stale customer mismatch', async () => {
    const businessId = await seedGoogleAdsConnection({
      status: 'ACTIVE',
      managerCustomerId: managerId,
      clientCustomerId: '9999999999',
    });
    await expect(assertMccLinkReadyForSetup(businessId, { refresh: false })).rejects.toMatchObject({
      code: 'ADS_MCC_LINK_REQUIRED',
    });
  });
});
