'use strict';

const { mongoose } = require('../shared');
require('../shared');
const { runOAuthTrace, runReadWriteTests } = require('../lib/dev/gtmOAuthLab');
const { createBareUser } = require('../../../backend/tests/helpers');
const BusinessContext = mongoose.model('BusinessContext');
const IntegrationConnection = mongoose.model('IntegrationConnection');

describe('gtmOAuthLab', () => {
  const prevEnv = { ...process.env };

  beforeEach(() => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'client-secret';
    process.env.JWT_SECRET = 'x'.repeat(32);
    process.env.TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
    process.env.GTM_API_ENABLED = 'true';
    process.env.GTM_API_MOCK = 'true';
    process.env.GOOGLE_OAUTH_MOCK = 'true';
  });

  afterEach(() => {
    process.env = { ...prevEnv };
  });

  it('runOAuthTrace fails for unknown businessId', async () => {
    const report = await runOAuthTrace('000000000000000000000001', null);
    expect(report.stages.find((s) => s.id === 'business_context')?.ok).toBe(false);
    expect(report.firstFailure?.id).toBe('business_context');
  });

  it('runReadWriteTests read mode succeeds with mock workspace', async () => {
    const { encryptToken } = require('../../../backend/lib/crypto/tokenEncryption');
    const user = await createBareUser('gtm-lab-read@test.com');
    const businessId = new mongoose.Types.ObjectId();
    await BusinessContext.create({
      businessId,
      userId: user._id,
      businessName: 'GTM Lab Read',
      confirmedAt: new Date(),
    });
    await IntegrationConnection.create({
      businessId,
      provider: 'gtm',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('mock-access'),
      refreshTokenEnc: encryptToken('mock-refresh'),
      scopes: ['https://www.googleapis.com/auth/tagmanager.edit.containers'],
      providerIdentifiers: {
        accountId: 'mock-account',
        containerId: 'mock-container',
        workspaceId: 'mock-workspace',
      },
    });

    const result = await runReadWriteTests(businessId.toString(), {
      accountId: 'mock-account',
      containerId: 'mock-container',
      workspaceId: 'mock-workspace',
      mode: 'read',
    });

    expect(result.mode).toBe('read');
    expect(result.workspaceReady).toBe(true);
    expect(result.stages.find((s) => s.id === 'check_workspace_access')?.ok).toBe(true);
    expect(result.stages.some((s) => s.id === 'read_gtm_tags')).toBe(true);
    expect(result.stages.some((s) => s.id === 'write_constant_variable')).toBe(false);
  });
});
