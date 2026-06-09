'use strict';

const { mongoose } = require('../shared');
const { encryptToken } = require('../../../backend/lib/crypto/tokenEncryption');
const { assertCreationDiagnosticConnection } = require('../lib/dev/assertCreationDiagnosticConnection');
const { allScopesForProvider } = require('../../../backend/constants/googleOAuth');

describe('assertCreationDiagnosticConnection', () => {
  async function seedConnection(provider, fields) {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');

    const user = await User.create({ email: `diag-gate-${Date.now()}@test.com` });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });

    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider,
      connectionHealth: 'connected',
      scopes: allScopesForProvider(provider),
      accessTokenEnc: encryptToken('token'),
      refreshTokenEnc: encryptToken('refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      providerIdentifiers:
        provider === 'google_ads'
          ? { customerId: '1234567890', accessibleCustomerIds: ['1234567890'] }
          : {
              accountId: 'acc',
              containerId: 'cont',
              workspaceId: 'ws',
            },
      ...fields,
    });

    return bc.businessId;
  }

  it('blocks selection_required Google Ads connections', async () => {
    const businessId = await seedConnection('google_ads', {
      connectionHealth: 'selection_required',
      providerIdentifiers: { accessibleCustomerIds: ['1234567890', '9876543210'] },
    });

    const gate = await assertCreationDiagnosticConnection(businessId, 'google_ads');
    expect(gate.ok).toBe(false);
    expect(gate.errorCode).toBe('SELECTION_REQUIRED');
  });

  it('blocks selection_required GTM connections', async () => {
    const businessId = await seedConnection('gtm', {
      connectionHealth: 'selection_required',
      providerIdentifiers: { discoveredAccountCount: 1 },
    });

    const gate = await assertCreationDiagnosticConnection(businessId, 'gtm');
    expect(gate.ok).toBe(false);
    expect(gate.errorCode).toBe('SELECTION_REQUIRED');
  });

  it('allows setup-ready Google Ads connections', async () => {
    const businessId = await seedConnection('google_ads', {});

    const gate = await assertCreationDiagnosticConnection(businessId, 'google_ads');
    expect(gate.ok).toBe(true);
  });
});
