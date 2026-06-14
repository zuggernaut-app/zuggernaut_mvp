'use strict';

const mongoose = require('mongoose');
const {
  fetchAndPersistConversionCatalog,
  classifyConversionAction,
  resolvePrimaryGoal,
  selectConversionActions,
  AdsCatalogPreconditionError,
} = require('../services/capabilities/adsConversionCatalogService');
const {
  fetchGoogleAdsConversionCatalogMock,
  normalizeConversionAction,
} = require('../services/integrations/googleAdsConversionCatalogClient');
const { createLogger } = require('../lib/observability/logger');

describe('adsConversionCatalogService', () => {
  const logger = createLogger({ level: 'silent' });

  async function seedRun(email, goals = { primary: 'both' }) {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const IntegrationConnection = mongoose.model('IntegrationConnection');

    const user = await User.create({ email });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      goals,
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      accessTokenEnc: 'x',
      refreshTokenEnc: 'y',
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: ['https://www.googleapis.com/auth/adwords'],
      providerIdentifiers: { customerId: '1234567890' },
    });

    return { bc, run };
  }

  it('classifies call and form conversion actions deterministically', () => {
    expect(
      classifyConversionAction({
        category: 'PHONE_CALL_LEAD',
        type: 'AD_CALL',
        name: 'Calls',
      })
    ).toBe('call');
    expect(
      classifyConversionAction({
        category: 'SUBMIT_LEAD_FORM',
        type: 'WEBPAGE',
        name: 'Form submit',
      })
    ).toBe('form');
    expect(
      classifyConversionAction({
        category: 'PAGE_VIEW',
        type: 'WEBPAGE',
        name: 'Homepage view',
      })
    ).toBe('other');
  });

  it('selects only call conversion for calls goal', () => {
    const catalog = [
      { externalId: '1', resourceName: 'a/1', logicalCategory: 'call', status: 'ENABLED' },
      { externalId: '2', resourceName: 'a/2', logicalCategory: 'form', status: 'ENABLED' },
    ];
    const selected = selectConversionActions(catalog, 'calls');
    expect(selected).toHaveLength(1);
    expect(selected[0].logicalCategory).toBe('call');
  });

  it('selects only form conversion for forms goal', () => {
    const catalog = [
      { externalId: '1', resourceName: 'a/1', logicalCategory: 'call', status: 'ENABLED' },
      { externalId: '2', resourceName: 'a/2', logicalCategory: 'form', status: 'ENABLED' },
    ];
    const selected = selectConversionActions(catalog, 'forms');
    expect(selected).toHaveLength(1);
    expect(selected[0].logicalCategory).toBe('form');
  });

  it('selects call and form for both goal', () => {
    const catalog = [
      { externalId: '1', resourceName: 'a/1', logicalCategory: 'call', status: 'ENABLED' },
      { externalId: '2', resourceName: 'a/2', logicalCategory: 'form', status: 'ENABLED' },
    ];
    const selected = selectConversionActions(catalog, 'both');
    expect(selected.map((s) => s.logicalCategory).sort()).toEqual(['call', 'form']);
  });

  it('fails when required category is missing', () => {
    const catalog = [{ externalId: '2', resourceName: 'a/2', logicalCategory: 'form', status: 'ENABLED' }];
    expect(() => selectConversionActions(catalog, 'calls')).toThrow(AdsCatalogPreconditionError);
  });

  it('maps leads goal to forms selection', () => {
    expect(resolvePrimaryGoal({ primary: 'leads' })).toBe('forms');
  });

  it('persists ProviderSnapshot and IntegrationArtifacts idempotently', async () => {
    const ProviderSnapshot = mongoose.model('ProviderSnapshot');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const { bc, run } = await seedRun('ads-idem@test.com', { primary: 'both' });

    await fetchAndPersistConversionCatalog({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });
    await fetchAndPersistConversionCatalog({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(await ProviderSnapshot.countDocuments({ setupRunId: run._id })).toBe(1);
    expect(
      await IntegrationArtifact.countDocuments({
        setupRunId: run._id,
        artifactType: 'ads_conversion_action',
      })
    ).toBe(2);
  });

  it('selects one artifact for calls goal using mock catalog', async () => {
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const { bc, run } = await seedRun('ads-calls@test.com', { primary: 'calls' });

    const result = await fetchAndPersistConversionCatalog({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(result.summary.primaryGoal).toBe('calls');
    expect(result.summary.selectedCount).toBe(1);
    expect(result.summary.selectedCategories).toEqual(['call']);

    const arts = await IntegrationArtifact.find({
      setupRunId: run._id,
      artifactType: 'ads_conversion_action',
    }).lean();
    expect(arts).toHaveLength(1);
    expect(arts[0].metadata.logicalCategory).toBe('call');
  });

  it('throws when customerId is missing on setup-ready connection', async () => {
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { bc, run } = await seedRun('ads-no-customer@test.com');
    await IntegrationConnection.updateOne(
      { businessId: bc.businessId, provider: 'google_ads' },
      {
        $set: {
          connectionHealth: 'provisioning_required',
          providerIdentifiers: { discoveryReason: 'ADS_PROVISIONING_REQUIRED' },
        },
      }
    );

    await expect(
      fetchAndPersistConversionCatalog({
        setupRunId: run._id,
        businessId: bc.businessId,
        logger,
      })
    ).rejects.toMatchObject({ code: 'ADS_MISSING_CUSTOMER_ID' });
  });

  it('throws when Ads API is not enabled and mock is off', async () => {
    const prevMock = process.env.GOOGLE_ADS_API_MOCK;
    const prevEnabled = process.env.GOOGLE_ADS_API_ENABLED;
    delete process.env.GOOGLE_ADS_API_MOCK;
    delete process.env.GOOGLE_ADS_API_ENABLED;

    const { bc, run } = await seedRun('ads-noapi@test.com');

    await expect(
      fetchAndPersistConversionCatalog({
        setupRunId: run._id,
        businessId: bc.businessId,
        logger,
      })
    ).rejects.toThrow(/Google Ads API is not enabled/);

    process.env.GOOGLE_ADS_API_MOCK = prevMock;
    process.env.GOOGLE_ADS_API_ENABLED = prevEnabled;
  });

  it('uses custom mockConversionActions from connection identifiers', async () => {
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { bc, run } = await seedRun('ads-custom-mock@test.com', { primary: 'forms' });

    await IntegrationConnection.updateOne(
      { businessId: bc.businessId, provider: 'google_ads' },
      {
        $set: {
          'providerIdentifiers.mockConversionActions': [
            {
              id: '9001',
              name: 'Lead form',
              category: 'SUBMIT_LEAD_FORM',
              type: 'WEBPAGE',
              status: 'ENABLED',
              includeInConversionsMetric: true,
            },
          ],
        },
      }
    );

    const result = await fetchAndPersistConversionCatalog({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(result.selectedIds).toEqual(['9001']);
    expect(result.source).toBe('google_ads_api_mock');
  });

  it('updates conversionStrategy with existing resolutions when catalog succeeds', async () => {
    const BusinessContext = mongoose.model('BusinessContext');
    const { bc, run } = await seedRun('ads-strategy-ok@test.com', { primary: 'both' });

    await fetchAndPersistConversionCatalog({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    const updated = await BusinessContext.findOne({ businessId: bc.businessId }).lean();
    expect(updated.conversionStrategy).toBeDefined();
    expect(updated.conversionStrategy.resolvedPrimaryGoal).toBe('both');
    expect(updated.conversionStrategy.requiredSlots).toHaveLength(2);
    expect(
      updated.conversionStrategy.requiredSlots.every((s) => s.resolution === 'existing')
    ).toBe(true);
    expect(
      updated.conversionStrategy.requiredSlots.map((s) => s.externalId).sort()
    ).toEqual(['1001', '1002']);
  });

  it('updates conversionStrategy with pending slot before failing on missing call', async () => {
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { bc, run } = await seedRun('ads-strategy-partial@test.com', { primary: 'both' });

    await IntegrationConnection.updateOne(
      { businessId: bc.businessId, provider: 'google_ads' },
      {
        $set: {
          'providerIdentifiers.mockConversionActions': [
            {
              id: '9002',
              name: 'Lead form',
              category: 'SUBMIT_LEAD_FORM',
              type: 'WEBPAGE',
              status: 'ENABLED',
              includeInConversionsMetric: true,
            },
          ],
        },
      }
    );

    await expect(
      fetchAndPersistConversionCatalog({
        setupRunId: run._id,
        businessId: bc.businessId,
        logger,
      })
    ).rejects.toThrow(/No call conversion action available/);

    const updated = await BusinessContext.findOne({ businessId: bc.businessId }).lean();
    const formSlot = updated.conversionStrategy.requiredSlots.find((s) => s.slot === 'form');
    const callSlot = updated.conversionStrategy.requiredSlots.find((s) => s.slot === 'call');
    expect(formSlot.resolution).toBe('existing');
    expect(formSlot.externalId).toBe('9002');
    expect(callSlot.resolution).toBe('pending');
    expect(callSlot.externalId).toBeNull();
  });

  it('fails when mock catalog lacks required form conversion', async () => {
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const { bc, run } = await seedRun('ads-missing-form@test.com', { primary: 'forms' });

    await IntegrationConnection.updateOne(
      { businessId: bc.businessId, provider: 'google_ads' },
      {
        $set: {
          'providerIdentifiers.mockConversionActions': [
            {
              id: '9001',
              name: 'Calls only',
              category: 'PHONE_CALL_LEAD',
              type: 'AD_CALL',
              status: 'ENABLED',
              includeInConversionsMetric: true,
            },
          ],
        },
      }
    );

    await expect(
      fetchAndPersistConversionCatalog({
        setupRunId: run._id,
        businessId: bc.businessId,
        logger,
      })
    ).rejects.toThrow(/No form conversion action available/);
  });
});

describe('googleAdsConversionCatalogClient', () => {
  it('normalizeConversionAction maps API fields', () => {
    const normalized = normalizeConversionAction({
      id: '456',
      resourceName: 'customers/123/conversionActions/456',
      name: 'Form',
      category: 'SUBMIT_LEAD_FORM',
      status: 'ENABLED',
      type: 'WEBPAGE',
      includeInConversionsMetric: true,
    });

    expect(normalized.externalId).toBe('456');
    expect(normalized.resourceName).toContain('456');
    expect(normalized.includeInConversionsMetric).toBe(true);
  });

  it('fetchGoogleAdsConversionCatalogMock labels source explicitly', async () => {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const IntegrationConnection = mongoose.model('IntegrationConnection');

    const user = await User.create({ email: 'ads-mock@test.com' });
    const bc = await BusinessContext.create({ userId: user._id, confirmedAt: new Date() });
    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      providerIdentifiers: { customerId: '1234567890' },
    });

    const readModel = await fetchGoogleAdsConversionCatalogMock(bc.businessId);
    expect(readModel.source).toBe('google_ads_api_mock');
    expect(readModel.conversionActions.length).toBeGreaterThanOrEqual(2);
  });
});
