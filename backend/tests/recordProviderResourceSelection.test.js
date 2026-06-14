'use strict';

const mongoose = require('mongoose');
const { recordProviderResourceSelection } = require('../services/integrations/recordProviderResourceSelection');
const { SELECTION_SOURCE } = require('../constants/providerResourceSelection');

describe('recordProviderResourceSelection', () => {
  async function seedConnection(provider) {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');

    const user = await User.create({ email: `sel-${provider}@test.com` });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      businessName: 'Selection Co',
    });

    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider,
      connectionHealth: 'selection_required',
      accessTokenEnc: 'x',
      refreshTokenEnc: 'y',
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: ['scope'],
      providerIdentifiers: { selectionRequired: true },
    });

    return bc;
  }

  it('persists GTM selection and sets connectionHealth connected', async () => {
    const bc = await seedConnection('gtm');
    const identifiers = {
      accountId: 'acc-1',
      containerId: 'ctr-1',
      workspaceId: 'ws-1',
      publicContainerId: 'GTM-ABC',
    };

    await recordProviderResourceSelection(bc.businessId, 'gtm', identifiers, {
      source: SELECTION_SOURCE.PRODUCT_SETUP,
    });

    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const row = await IntegrationConnection.findOne({ businessId: bc.businessId, provider: 'gtm' }).lean();
    expect(row.connectionHealth).toBe('connected');
    expect(row.providerIdentifiers.accountId).toBe('acc-1');
    expect(row.providerIdentifiers.selectionRequired).toBe(false);
    expect(row.providerIdentifiers.selectionHistory).toHaveLength(1);
  });

  it('persists Google Ads selection identifiers', async () => {
    const bc = await seedConnection('google_ads');
    const identifiers = {
      customerId: '1234567890',
      accessibleCustomerIds: ['1234567890'],
      loginCustomerId: '999',
    };

    await recordProviderResourceSelection(bc.businessId, 'google_ads', identifiers);

    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const row = await IntegrationConnection.findOne({
      businessId: bc.businessId,
      provider: 'google_ads',
    }).lean();
    expect(row.connectionHealth).toBe('connected');
    expect(row.providerIdentifiers.customerId).toBe('1234567890');
    expect(row.providerIdentifiers.selectionRequired).toBe(false);
  });
});
