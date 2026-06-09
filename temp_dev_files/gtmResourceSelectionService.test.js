'use strict';

const mongoose = require('mongoose');
const axios = require('axios');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { resetProviderRateLimitsForTests } = require('../lib/providerRateLimit');
const {
  listGtmResourceOptions,
  saveGtmSelection,
  GtmResourceSelectionError,
} = require('../services/dev/gtmResourceSelectionService');

jest.mock('axios');

describe('gtmResourceSelectionService', () => {
  beforeEach(() => {
    resetProviderRateLimitsForTests();
    jest.clearAllMocks();
    process.env.GTM_API_MOCK = 'true';
  });

  async function seedConnection(overrides = {}) {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');

    const user = await User.create({ email: `gtm-select-${Date.now()}@test.com` });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      businessName: 'GTM Selection Sandbox',
    });

    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'gtm',
      connectionHealth: 'selection_required',
      accessTokenEnc: encryptToken('gtm-access'),
      refreshTokenEnc: encryptToken('gtm-refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: [
        'https://www.googleapis.com/auth/tagmanager.edit.containers',
        'https://www.googleapis.com/auth/tagmanager.publish',
        'https://www.googleapis.com/auth/tagmanager.manage.accounts',
      ],
      providerIdentifiers: {
        discoveredAccountCount: 1,
        discoveredContainerCount: 1,
        discoveredWorkspaceCount: 1,
      },
      ...overrides,
    });

    return bc;
  }

  it('lists GTM account/container/workspace options', async () => {
    const bc = await seedConnection();
    const result = await listGtmResourceOptions(bc.businessId);

    expect(result.selectionRequired).toBe(true);
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].containers[0].workspaces).toHaveLength(1);
  });

  it('persists explicit GTM selection', async () => {
    const bc = await seedConnection();
    const saved = await saveGtmSelection(bc.businessId, {
      accountId: 'mock-account',
      containerId: 'mock-container',
      workspaceId: 'mock-workspace',
    });

    expect(saved.selectionRequired).toBe(false);
    expect(saved.selected.publicContainerId).toBe('GTM-MOCK');

    const conn = await mongoose.model('IntegrationConnection').findOne({
      businessId: bc.businessId,
      provider: 'gtm',
    }).lean();
    expect(conn.connectionHealth).toBe('connected');
    expect(conn.providerIdentifiers.workspaceId).toBe('mock-workspace');
  });

  it('rejects inaccessible GTM selection', async () => {
    const bc = await seedConnection();

    await expect(
      saveGtmSelection(bc.businessId, {
        accountId: 'missing',
        containerId: 'mock-container',
        workspaceId: 'mock-workspace',
      })
    ).rejects.toMatchObject({ code: 'GTM_SELECTION_NOT_ACCESSIBLE' });
  });
});
