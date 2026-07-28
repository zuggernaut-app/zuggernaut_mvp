'use strict';

const mongoose = require('mongoose');
const {
  runGtmConversionSetup,
  GtmProviderPreconditionError,
  gtmTriggerIdFromPath,
  requiredClickBuiltinTypes,
} = require('../services/capabilities/gtmConversionSetupService');
const { buildGtmSetupPlan } = require('../services/capabilities/gtmTemplates/v1');
const { encryptToken } = require('../lib/crypto/tokenEncryption');
const { createLogger } = require('../lib/observability/logger');
const { allScopesForProvider } = require('../constants/googleOAuth');

describe('gtmConversionSetupService', () => {
  const logger = createLogger({ level: 'silent' });

  async function seedGtmRun(email, goalPrimary = 'both') {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');

    const user = await User.create({ email });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      websiteUrl: 'https://acme.example',
      goals: { primary: goalPrimary },
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });

    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('gtm-access'),
      refreshTokenEnc: encryptToken('gtm-refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: ['https://www.googleapis.com/auth/adwords'],
      providerIdentifiers: { customerId: '1234567890' },
    });

    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'gtm',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('gtm-access'),
      refreshTokenEnc: encryptToken('gtm-refresh'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: allScopesForProvider('gtm'),
      providerIdentifiers: {
        accountId: 'mock-account',
        containerId: 'mock-container',
        workspaceId: 'mock-workspace',
        publicContainerId: 'GTM-MOCK',
      },
    });

    const convArtifacts =
      goalPrimary === 'calls'
        ? [{ externalId: '1001', logicalCategory: 'call', name: 'Call conv' }]
        : goalPrimary === 'forms'
          ? [{ externalId: '1002', logicalCategory: 'form', name: 'Form conv' }]
          : [
              { externalId: '1001', logicalCategory: 'call', name: 'Call conv' },
              { externalId: '1002', logicalCategory: 'form', name: 'Form conv' },
            ];

    for (const row of convArtifacts) {
      await IntegrationArtifact.create({
        setupRunId: run._id,
        businessId: bc.businessId,
        provider: 'google_ads',
        artifactType: 'ads_conversion_action',
        externalId: row.externalId,
        idempotencyKey: `ads-ca-${run._id}-${row.logicalCategory}`,
        metadata: { logicalCategory: row.logicalCategory, name: row.name },
      });
    }

    return { bc, run };
  }

  it('buildGtmSetupPlan includes form and call resources for both goal', () => {
    const plan = buildGtmSetupPlan({
      conversionArtifacts: [
        { externalId: '1001', metadata: { logicalCategory: 'call' } },
        { externalId: '1002', metadata: { logicalCategory: 'form' } },
      ],
      adsCustomerId: '1234567890',
      websiteUrl: 'https://acme.example',
    });

    expect(plan.templateVersion).toBe(1);
    const keys = plan.resources.map((r) => r.logicalKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        'trig_form_confirmation_url',
        'trig_form_submit_click',
        'trig_call_tel_click',
        'trig_call_element_hint_click',
        'tag_form_conversion',
        'tag_call_conversion',
      ])
    );
  });

  it('buildGtmSetupPlan includes only call resources for calls goal', () => {
    const plan = buildGtmSetupPlan({
      conversionArtifacts: [{ externalId: '1001', metadata: { logicalCategory: 'call' } }],
      adsCustomerId: '1234567890',
      websiteUrl: 'https://acme.example',
    });

    const keys = plan.resources.map((r) => r.logicalKey);
    expect(keys).toEqual(
      expect.arrayContaining(['trig_call_tel_click', 'tag_call_conversion'])
    );
    expect(keys).not.toEqual(expect.arrayContaining(['tag_form_conversion']));
  });

  it('fails when no Ads conversion artifacts exist', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const user = await User.create({ email: 'gtm-no-conv@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });

    await expect(
      runGtmConversionSetup({ setupRunId: run._id, businessId: bc.businessId, logger })
    ).rejects.toMatchObject({ code: 'GTM_MISSING_ADS_CONVERSIONS' });
  });

  it('fails when GTM identifiers are incomplete', async () => {
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { bc, run } = await seedGtmRun('gtm-bad-ids@test.com', 'calls');

    await IntegrationConnection.updateOne(
      { businessId: bc.businessId, provider: 'gtm' },
      { $set: { providerIdentifiers: { containerId: 'only-container' } } }
    );

    await expect(
      runGtmConversionSetup({ setupRunId: run._id, businessId: bc.businessId, logger })
    ).rejects.toMatchObject({ code: 'GTM_MISSING_IDENTIFIERS' });
  });

  it('fails when GTM API is not enabled and mock is off', async () => {
    const prevMock = process.env.GTM_API_MOCK;
    const prevEnabled = process.env.GTM_API_ENABLED;
    delete process.env.GTM_API_MOCK;
    delete process.env.GTM_API_ENABLED;

    const { bc, run } = await seedGtmRun('gtm-noapi@test.com', 'calls');

    await expect(
      runGtmConversionSetup({ setupRunId: run._id, businessId: bc.businessId, logger })
    ).rejects.toMatchObject({ code: 'GTM_API_NOT_ENABLED' });

    process.env.GTM_API_MOCK = prevMock;
    process.env.GTM_API_ENABLED = prevEnabled;
  });

  it('gtmTriggerIdFromPath extracts numeric id from GTM trigger resource path', () => {
    expect(
      gtmTriggerIdFromPath(
        'accounts/6357971694/containers/253902272/workspaces/2/triggers/7'
      )
    ).toBe('7');
    expect(gtmTriggerIdFromPath('accounts/mock-account/containers/mock-container/workspaces/mock-workspace/triggers/trig_call_tel_click')).toBeNull();
  });

  it('requiredClickBuiltinTypes maps click trigger filters to built-in variable types', () => {
    const plan = buildGtmSetupPlan({
      conversionArtifacts: [
        { externalId: '1001', metadata: { logicalCategory: 'call' } },
        { externalId: '1002', metadata: { logicalCategory: 'form' } },
      ],
      adsCustomerId: '1234567890',
      websiteUrl: 'https://acme.example',
    });

    expect(requiredClickBuiltinTypes(plan)).toEqual(
      expect.arrayContaining(['clickUrl', 'clickText', 'clickElement'])
    );
    expect(requiredClickBuiltinTypes(plan)).toHaveLength(3);
  });

  it('creates call-only GTM artifacts for calls goal', async () => {
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const { bc, run } = await seedGtmRun('gtm-calls@test.com', 'calls');

    const result = await runGtmConversionSetup({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(result.summary.tagsCreated).toBe(1);
    expect(result.summary.triggersCreated).toBe(2);
    expect(result.summary.source).toBe('gtm_api_mock');

    const tags = await IntegrationArtifact.find({
      setupRunId: run._id,
      provider: 'gtm',
      artifactType: 'gtm_tag',
    }).lean();
    expect(tags).toHaveLength(1);
    expect(tags[0].metadata.template).toBe('ads_conversion_call');
  });

  it('creates form-only GTM artifacts for forms goal', async () => {
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const { bc, run } = await seedGtmRun('gtm-forms@test.com', 'forms');

    await runGtmConversionSetup({ setupRunId: run._id, businessId: bc.businessId, logger });

    const tags = await IntegrationArtifact.find({
      setupRunId: run._id,
      provider: 'gtm',
      artifactType: 'gtm_tag',
    }).lean();
    expect(tags).toHaveLength(1);
    expect(tags[0].metadata.template).toBe('ads_conversion_form');
  });

  it('creates both tag families for both goal', async () => {
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const { bc, run } = await seedGtmRun('gtm-both@test.com', 'both');

    const result = await runGtmConversionSetup({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(result.summary.tagsCreated).toBe(2);
    expect(result.summary.triggersCreated).toBe(4);

    const tags = await IntegrationArtifact.find({
      setupRunId: run._id,
      provider: 'gtm',
      artifactType: 'gtm_tag',
    }).lean();
    expect(tags).toHaveLength(2);
  });

  it('persists artifacts and snapshot idempotently on retry', async () => {
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const ProviderSnapshot = mongoose.model('ProviderSnapshot');
    const { bc, run } = await seedGtmRun('gtm-idem@test.com', 'calls');

    await runGtmConversionSetup({ setupRunId: run._id, businessId: bc.businessId, logger });
    const second = await runGtmConversionSetup({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(second.summary.reusedArtifacts).toBeGreaterThan(0);
    expect(second.summary.tagsCreated).toBe(0);
    expect(await ProviderSnapshot.countDocuments({ setupRunId: run._id, provider: 'gtm' })).toBe(1);

    const tagCount = await IntegrationArtifact.countDocuments({
      setupRunId: run._id,
      provider: 'gtm',
      artifactType: 'gtm_tag',
    });
    expect(tagCount).toBe(1);
  });

  it('persists published container version artifact', async () => {
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const ProviderSnapshot = mongoose.model('ProviderSnapshot');
    const { bc, run } = await seedGtmRun('gtm-version@test.com', 'calls');

    await runGtmConversionSetup({ setupRunId: run._id, businessId: bc.businessId, logger });

    const versionArt = await IntegrationArtifact.findOne({
      setupRunId: run._id,
      provider: 'gtm',
      artifactType: 'gtm_container',
    }).lean();
    expect(versionArt).toBeTruthy();
    expect(versionArt.metadata.role).toBe('container_version');

    const snap = await ProviderSnapshot.findOne({
      setupRunId: run._id,
      snapshotType: 'gtm_container_version',
    }).lean();
    expect(snap?.payload?.publishedVersionPath).toBeTruthy();
    expect(snap?.payload?.source).toBe('gtm_api_mock');
  });
});

describe('GtmProviderPreconditionError', () => {
  it('carries explicit error codes', () => {
    const err = new GtmProviderPreconditionError('missing', 'GTM_MISSING_CONNECTION');
    expect(err.code).toBe('GTM_MISSING_CONNECTION');
  });
});

describe('googleTagManagerClient submitted workspace helpers', () => {
  const {
    GtmApiError,
    isGtmWorkspaceAlreadySubmittedError,
    isGtmWorkspaceAlreadySubmittedResponse,
  } = require('../services/integrations/googleTagManagerClient');

  it('detects submitted workspace API response', () => {
    expect(
      isGtmWorkspaceAlreadySubmittedResponse({
        status: 400,
        data: { error: { message: 'Workspace is already submitted.' } },
      })
    ).toBe(true);
    expect(isGtmWorkspaceAlreadySubmittedResponse({ status: 400, data: { error: { message: 'Other' } } })).toBe(
      false
    );
  });

  it('detects submitted workspace error from thrown GtmApiError', () => {
    const versionErr = new GtmApiError(
      'GTM container version create failed (400): Workspace is already submitted.',
      'GTM_VERSION_CREATE_FAILED'
    );
    expect(isGtmWorkspaceAlreadySubmittedError(versionErr)).toBe(true);

    const variablesErr = new GtmApiError(
      'GTM variables create failed (400): Workspace is already submitted.',
      'GTM_CREATE_FAILED'
    );
    expect(isGtmWorkspaceAlreadySubmittedError(variablesErr)).toBe(true);

    expect(isGtmWorkspaceAlreadySubmittedError(new GtmApiError('other', 'GTM_VERSION_CREATE_FAILED'))).toBe(
      false
    );
    expect(isGtmWorkspaceAlreadySubmittedError(new GtmApiError('other', 'GTM_CREATE_FAILED'))).toBe(false);
  });
});
