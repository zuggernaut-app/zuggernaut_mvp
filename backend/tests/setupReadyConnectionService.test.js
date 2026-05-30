'use strict';

const mongoose = require('mongoose');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { allScopesForProvider } = require('../constants/googleOAuth');
const {
  loadSetupReadyConnection,
  requireSetupReadyConnection,
  SetupReadyConnectionError,
  normalizeGtmIdentifiers,
} = require('../services/capabilities/setupReadyConnectionService');

class TestPreconditionError extends Error {
  constructor(message, code = 'TEST_PRECONDITION') {
    super(message);
    this.code = code;
  }
}

describe('setupReadyConnectionService', () => {
  async function createBusiness(email = `src-${Date.now()}@test.com`) {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const user = await User.create({ email });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    return { user, businessId: bc.businessId };
  }

  it('returns normalized GTM identifiers when connection is setup-ready', async () => {
    const { businessId } = await createBusiness();
    await mongoose.model('IntegrationConnection').create({
      businessId,
      provider: 'gtm',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: allScopesForProvider('gtm'),
      providerIdentifiers: {
        accountId: 'acc-1',
        containerId: 'cont-1',
        workspaceId: 'ws-1',
        publicContainerId: 'GTM-ABC',
      },
    });

    const ready = await loadSetupReadyConnection(businessId, 'gtm', { selectTokens: true });
    expect(ready.gtmIds.accountId).toBe('acc-1');
    expect(ready.gtmIds.publicContainerId).toBe('GTM-ABC');
    expect(ready.connection.accessTokenEnc).toBeTruthy();
  });

  it('returns normalized Google Ads customerId when connection is setup-ready', async () => {
    const { businessId } = await createBusiness();
    await mongoose.model('IntegrationConnection').create({
      businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: ['https://www.googleapis.com/auth/adwords'],
      providerIdentifiers: { customerId: '123-456-7890', loginCustomerId: '999' },
    });

    const ready = await loadSetupReadyConnection(businessId, 'google_ads');
    expect(ready.customerId).toBe('1234567890');
    expect(ready.loginCustomerId).toBe('999');
  });

  it('throws GTM_MISSING_IDENTIFIERS when required GTM ids are missing', async () => {
    const { businessId } = await createBusiness();
    await mongoose.model('IntegrationConnection').create({
      businessId,
      provider: 'gtm',
      connectionHealth: 'provisioning_required',
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: allScopesForProvider('gtm'),
      providerIdentifiers: { discoveryReason: 'GTM_PROVISIONING_REQUIRED' },
    });

    await expect(loadSetupReadyConnection(businessId, 'gtm')).rejects.toMatchObject({
      code: 'GTM_MISSING_IDENTIFIERS',
    });
  });

  it('throws ADS_MISSING_CUSTOMER_ID when Google Ads customerId is missing', async () => {
    const { businessId } = await createBusiness();
    await mongoose.model('IntegrationConnection').create({
      businessId,
      provider: 'google_ads',
      connectionHealth: 'provisioning_required',
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: ['https://www.googleapis.com/auth/adwords'],
      providerIdentifiers: { discoveryReason: 'ADS_PROVISIONING_REQUIRED' },
    });

    await expect(loadSetupReadyConnection(businessId, 'google_ads')).rejects.toMatchObject({
      code: 'ADS_MISSING_CUSTOMER_ID',
    });
  });

  it('requireSetupReadyConnection maps errors to caller error class', async () => {
    const { businessId } = await createBusiness();

    await expect(
      requireSetupReadyConnection(businessId, 'google_ads', TestPreconditionError)
    ).rejects.toBeInstanceOf(TestPreconditionError);

    await expect(
      requireSetupReadyConnection(businessId, 'google_ads', TestPreconditionError)
    ).rejects.toMatchObject({ code: 'ADS_MISSING_CONNECTION' });
  });

  it('normalizeGtmIdentifiers throws SetupReadyConnectionError for incomplete ids', () => {
    expect(() => normalizeGtmIdentifiers({ accountId: 'a1' })).toThrow(SetupReadyConnectionError);
  });
});
