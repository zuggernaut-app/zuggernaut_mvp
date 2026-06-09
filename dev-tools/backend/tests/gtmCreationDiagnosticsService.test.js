'use strict';

const { mongoose } = require('../shared');
require('../shared');
const { createBareUser } = require('../../../backend/tests/helpers');
const { encryptToken } = require('../../../backend/lib/crypto/tokenEncryption');
const { ensureSandboxBusiness } = require('../services/dev/integrationDiagnosticsService');
const { runGtmCreationDiagnostics } = require('../services/dev/gtmCreationDiagnosticsService');
const { getCreationDiagnosticSteps } = require('../lib/dev/creationDiagnosticsMatrix');

const IntegrationConnection = mongoose.model('IntegrationConnection');

describe('gtmCreationDiagnosticsService', () => {
  beforeEach(() => {
    process.env.GTM_API_MOCK = 'true';
  });

  it('runs the full GTM matrix in create_paused mode without publishing', async () => {
    const user = await createBareUser('gtm-create-diag@test.com');
    const sandbox = await ensureSandboxBusiness(user._id);

    const gtmScopes = [
      'https://www.googleapis.com/auth/tagmanager.edit.containers',
      'https://www.googleapis.com/auth/tagmanager.publish',
      'https://www.googleapis.com/auth/tagmanager.manage.accounts',
    ];

    await IntegrationConnection.create({
      businessId: sandbox.businessId,
      provider: 'gtm',
      connectionHealth: 'connected',
      scopes: gtmScopes,
      accessTokenEnc: encryptToken('mock-access-token'),
      refreshTokenEnc: encryptToken('mock-refresh-token'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      providerIdentifiers: {
        accountId: '6357971694',
        containerId: '253902272',
        workspaceId: '2',
        publicContainerId: 'GTM-TEST',
      },
    });

    const result = await runGtmCreationDiagnostics(sandbox.businessId, { mode: 'create_paused' });

    expect(result.provider).toBe('gtm');
    expect(result.mode).toBe('create_paused');
    expect(result.steps).toHaveLength(getCreationDiagnosticSteps('gtm').length);
    expect(result.steps.find((step) => step.name === 'publish_version')).toMatchObject({
      skipped: true,
      ok: true,
    });
    expect(result.ok).toBe(true);
    expect(result.diagnosticRunId).toBeTruthy();
  });

  it('skips GA4 tag when measurement ID is missing', async () => {
    const user = await createBareUser('gtm-create-diag-ga4@test.com');
    const sandbox = await ensureSandboxBusiness(user._id);
    const gtmScopes = [
      'https://www.googleapis.com/auth/tagmanager.edit.containers',
      'https://www.googleapis.com/auth/tagmanager.publish',
      'https://www.googleapis.com/auth/tagmanager.manage.accounts',
    ];

    await IntegrationConnection.create({
      businessId: sandbox.businessId,
      provider: 'gtm',
      connectionHealth: 'connected',
      scopes: gtmScopes,
      accessTokenEnc: encryptToken('mock-access-token'),
      refreshTokenEnc: encryptToken('mock-refresh-token'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      providerIdentifiers: {
        accountId: '6357971694',
        containerId: '253902272',
        workspaceId: '2',
      },
    });

    const result = await runGtmCreationDiagnostics(sandbox.businessId, { mode: 'create_paused' });
    const ga4 = result.steps.find((step) => step.name === 'ga4_config_tag');
    expect(ga4).toMatchObject({ skipped: true, ok: true });
  });

  it('publishes only in create_and_publish mode', async () => {
    const user = await createBareUser('gtm-create-diag-publish@test.com');
    const sandbox = await ensureSandboxBusiness(user._id);
    const gtmScopes = [
      'https://www.googleapis.com/auth/tagmanager.edit.containers',
      'https://www.googleapis.com/auth/tagmanager.publish',
      'https://www.googleapis.com/auth/tagmanager.manage.accounts',
    ];

    await IntegrationConnection.create({
      businessId: sandbox.businessId,
      provider: 'gtm',
      connectionHealth: 'connected',
      scopes: gtmScopes,
      accessTokenEnc: encryptToken('mock-access-token'),
      refreshTokenEnc: encryptToken('mock-refresh-token'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      providerIdentifiers: {
        accountId: '6357971694',
        containerId: '253902272',
        workspaceId: '2',
      },
    });

    const paused = await runGtmCreationDiagnostics(sandbox.businessId, { mode: 'create_paused' });
    expect(paused.steps.find((s) => s.name === 'publish_version')).toMatchObject({
      skipped: true,
      ok: true,
    });

    const published = await runGtmCreationDiagnostics(sandbox.businessId, {
      mode: 'create_and_publish',
    });
    expect(published.steps.find((s) => s.name === 'publish_version')).toMatchObject({
      skipped: false,
      ok: true,
    });
  });

  it('returns MISSING_CONNECTION when GTM is not connected', async () => {
    const user = await createBareUser('gtm-create-diag-missing@test.com');
    const sandbox = await ensureSandboxBusiness(user._id);

    const result = await runGtmCreationDiagnostics(sandbox.businessId);

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('MISSING_CONNECTION');
    expect(result.steps).toHaveLength(0);
  });
});
