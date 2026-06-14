'use strict';

const {
  CONVERSION_SLOTS_BY_GOAL,
  DEFAULT_CONVERSION_ACTION_TEMPLATES,
} = require('../constants/conversionActionRequirements');
const { CONVERSION_MANAGEMENT_OUTCOME, ARTIFACT_TYPES } = require('../constants/enums');
const { SETUP_STEP_NAMES } = require('../constants/setupWorkflow');
const { resolvePrimaryGoal } = require('../services/capabilities/adsConversionCatalogService');
const mongoose = require('mongoose');
const { adsConversionActionCreationIdempotencyKey, PROVIDER_MUTATION_CONTRACT } = require('../constants/idempotency');
const { createLogger } = require('../lib/observability/logger');
const {
  ConversionActionTemplateError,
  deriveConversionStrategy,
  matchSlotsToExistingActions,
  resolveStrategyWithCatalog,
  createConversionActionForSlot,
  fillUnmatchedSlots,
  manageConversionActions,
} = require('../services/capabilities/adsConversionActionManagementService');
const { connectGoogleIntegrations } = require('./fixtures/setupRunFixtures');

const REQUIRED_TEMPLATE_FIELDS = ['name', 'category', 'type', 'status'];
const REQUIRED_STRATEGY_KEYS = ['resolvedPrimaryGoal', 'requiredSlots', 'derivedFrom', 'derivedAt'];
const REQUIRED_SLOT_KEYS = [
  'slot',
  'logicalCategory',
  'required',
  'resolution',
  'externalId',
  'resourceName',
];

describe('conversionActionRequirements contracts', () => {
  it('maps every resolvePrimaryGoal output to CONVERSION_SLOTS_BY_GOAL', () => {
    const goalInputs = [
      { primary: null },
      { primary: '' },
      { primary: 'calls' },
      { primary: 'forms' },
      { primary: 'both' },
      { primary: 'generate_leads' },
    ];

    for (const goals of goalInputs) {
      const resolved = resolvePrimaryGoal(goals);
      expect(CONVERSION_SLOTS_BY_GOAL[resolved]).toBeDefined();
      expect(Array.isArray(CONVERSION_SLOTS_BY_GOAL[resolved])).toBe(true);
      expect(CONVERSION_SLOTS_BY_GOAL[resolved].length).toBeGreaterThan(0);
    }
  });

  it('has a DEFAULT_CONVERSION_ACTION_TEMPLATES entry for every slot logicalCategory', () => {
    for (const slots of Object.values(CONVERSION_SLOTS_BY_GOAL)) {
      for (const slot of slots) {
        const template = DEFAULT_CONVERSION_ACTION_TEMPLATES[slot.logicalCategory];
        expect(template).toBeDefined();
        for (const field of REQUIRED_TEMPLATE_FIELDS) {
          expect(template[field]).toBeTruthy();
        }
      }
    }
  });

  it('defines CONVERSION_MANAGEMENT_OUTCOME values', () => {
    expect(CONVERSION_MANAGEMENT_OUTCOME).toEqual(
      expect.arrayContaining([
        'ok',
        'created',
        'missing_goal_data',
        'creation_failed',
        'manual_review',
      ])
    );
  });

  it('defines ads_conversion_action_created artifact type', () => {
    expect(ARTIFACT_TYPES).toContain('ads_conversion_action_created');
  });

  it('defines MANAGE_ADS_CONVERSION_ACTIONS setup step name', () => {
    expect(SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS).toBe(
      'manage_ads_conversion_actions'
    );
    expect(typeof SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS).toBe('string');
  });

  it('documents MANAGE_ADS_CONVERSION_ACTIONS in PROVIDER_MUTATION_CONTRACT', () => {
    const row = PROVIDER_MUTATION_CONTRACT.find(
      (entry) => entry.stepName === SETUP_STEP_NAMES.MANAGE_ADS_CONVERSION_ACTIONS
    );
    expect(row).toBeDefined();
    expect(row.artifactTypes).toEqual(['ads_conversion_action_created']);
    expect(row.idempotencyKey({ setupRunId: 'run1', slot: 'call' })).toBe(
      'ads-ca-create-run1-call'
    );
  });
});

describe('deriveConversionStrategy', () => {
  function assertStrategyShape(strategy) {
    for (const key of REQUIRED_STRATEGY_KEYS) {
      expect(strategy).toHaveProperty(key);
    }
    expect(['calls', 'forms', 'both']).toContain(strategy.resolvedPrimaryGoal);
    expect(['scrape_goals', 'user_confirmed_goals', 'default']).toContain(strategy.derivedFrom);
    expect(() => new Date(strategy.derivedAt).toISOString()).not.toThrow();
    expect(Array.isArray(strategy.requiredSlots)).toBe(true);
    for (const slot of strategy.requiredSlots) {
      for (const key of REQUIRED_SLOT_KEYS) {
        expect(slot).toHaveProperty(key);
      }
      expect(slot.resolution).toBe('pending');
      expect(slot.externalId).toBeNull();
      expect(slot.resourceName).toBeNull();
    }
  }

  it('derives calls goal with one call slot', () => {
    const strategy = deriveConversionStrategy({
      goals: { primary: 'calls' },
      confirmedAt: new Date(),
    });
    expect(strategy.resolvedPrimaryGoal).toBe('calls');
    expect(strategy.requiredSlots).toHaveLength(1);
    expect(strategy.requiredSlots[0].slot).toBe('call');
    expect(strategy.derivedFrom).toBe('user_confirmed_goals');
    assertStrategyShape(strategy);
  });

  it('derives forms goal with one form slot', () => {
    const strategy = deriveConversionStrategy({
      goals: { primary: 'forms' },
      confirmedAt: new Date(),
    });
    expect(strategy.resolvedPrimaryGoal).toBe('forms');
    expect(strategy.requiredSlots).toHaveLength(1);
    expect(strategy.requiredSlots[0].slot).toBe('form');
    assertStrategyShape(strategy);
  });

  it('derives both goal with call and form slots', () => {
    const strategy = deriveConversionStrategy({
      goals: { primary: 'both' },
      confirmedAt: new Date(),
    });
    expect(strategy.resolvedPrimaryGoal).toBe('both');
    expect(strategy.requiredSlots).toHaveLength(2);
    expect(strategy.requiredSlots.map((s) => s.slot)).toEqual(['call', 'form']);
    assertStrategyShape(strategy);
  });

  it('defaults to both when goals is null', () => {
    const strategy = deriveConversionStrategy({ goals: null });
    expect(strategy.resolvedPrimaryGoal).toBe('both');
    expect(strategy.requiredSlots).toHaveLength(2);
    expect(strategy.derivedFrom).toBe('default');
    assertStrategyShape(strategy);
  });

  it('defaults to both when goals is undefined', () => {
    const strategy = deriveConversionStrategy({});
    expect(strategy.resolvedPrimaryGoal).toBe('both');
    expect(strategy.requiredSlots).toHaveLength(2);
    expect(strategy.derivedFrom).toBe('default');
    assertStrategyShape(strategy);
  });

  it('defaults generate_leads to both via resolvePrimaryGoal', () => {
    const strategy = deriveConversionStrategy({
      goals: { primary: 'generate_leads' },
      confirmedAt: new Date(),
    });
    expect(strategy.resolvedPrimaryGoal).toBe('both');
    expect(strategy.requiredSlots).toHaveLength(2);
    assertStrategyShape(strategy);
  });

  it('uses user_confirmed_goals when goals set and confirmedAt present', () => {
    const strategy = deriveConversionStrategy({
      goals: { primary: 'calls' },
      confirmedAt: new Date('2026-06-10T12:00:00.000Z'),
    });
    expect(strategy.derivedFrom).toBe('user_confirmed_goals');
  });

  it('uses scrape_goals when goals set but not confirmed', () => {
    const strategy = deriveConversionStrategy({
      goals: { primary: 'calls' },
      confirmedAt: null,
    });
    expect(strategy.derivedFrom).toBe('scrape_goals');
  });
});

describe('matchSlotsToExistingActions', () => {
  const bothSlots = deriveConversionStrategy({
    goals: { primary: 'both' },
    confirmedAt: new Date(),
  }).requiredSlots;

  const callOnlySlots = deriveConversionStrategy({
    goals: { primary: 'calls' },
    confirmedAt: new Date(),
  }).requiredSlots;

  it('matches all slots when catalog has call and form', () => {
    const catalog = [
      {
        externalId: '1',
        resourceName: 'customers/1/conversionActions/1',
        logicalCategory: 'call',
        status: 'ENABLED',
        includeInConversionsMetric: true,
      },
      {
        externalId: '2',
        resourceName: 'customers/1/conversionActions/2',
        logicalCategory: 'form',
        status: 'ENABLED',
        includeInConversionsMetric: true,
      },
    ];

    const { matched, unmatched } = matchSlotsToExistingActions(bothSlots, catalog);
    expect(matched).toHaveLength(2);
    expect(unmatched).toHaveLength(0);
    expect(matched.every((s) => s.resolution === 'existing')).toBe(true);
    expect(matched.map((s) => s.externalId).sort()).toEqual(['1', '2']);
  });

  it('reports unmatched slot when catalog lacks call', () => {
    const catalog = [
      {
        externalId: '2',
        resourceName: 'customers/1/conversionActions/2',
        logicalCategory: 'form',
        status: 'ENABLED',
      },
    ];

    const { matched, unmatched } = matchSlotsToExistingActions(bothSlots, catalog);
    expect(matched).toHaveLength(1);
    expect(matched[0].logicalCategory).toBe('form');
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].logicalCategory).toBe('call');
    expect(unmatched[0].resolution).toBe('pending');
    expect(unmatched[0].externalId).toBeNull();
    expect(unmatched[0].resourceName).toBeNull();
  });

  it('reports all slots unmatched when catalog has only other actions', () => {
    const catalog = [
      {
        externalId: '9',
        resourceName: 'customers/1/conversionActions/9',
        logicalCategory: 'other',
        status: 'ENABLED',
      },
    ];

    const { matched, unmatched } = matchSlotsToExistingActions(bothSlots, catalog);
    expect(matched).toHaveLength(0);
    expect(unmatched).toHaveLength(2);
  });

  it('matches single call slot', () => {
    const catalog = [
      {
        externalId: '1',
        resourceName: 'customers/1/conversionActions/1',
        logicalCategory: 'call',
        status: 'ENABLED',
      },
    ];

    const { matched, unmatched } = matchSlotsToExistingActions(callOnlySlots, catalog);
    expect(matched).toHaveLength(1);
    expect(matched[0].slot).toBe('call');
    expect(unmatched).toHaveLength(0);
  });

  it('selects best-ranked call action when multiple exist', () => {
    const catalog = [
      {
        externalId: 'low',
        resourceName: 'customers/1/conversionActions/low',
        logicalCategory: 'call',
        status: 'PAUSED',
        includeInConversionsMetric: false,
      },
      {
        externalId: 'high',
        resourceName: 'customers/1/conversionActions/high',
        logicalCategory: 'call',
        status: 'ENABLED',
        includeInConversionsMetric: true,
      },
    ];

    const { matched } = matchSlotsToExistingActions(callOnlySlots, catalog);
    expect(matched[0].externalId).toBe('high');
  });

  it('consumes each catalog action only once', () => {
    const catalog = [
      {
        externalId: '1',
        resourceName: 'customers/1/conversionActions/1',
        logicalCategory: 'call',
        status: 'ENABLED',
      },
    ];

    const { matched, unmatched } = matchSlotsToExistingActions(bothSlots, catalog);
    expect(matched).toHaveLength(1);
    expect(matched[0].logicalCategory).toBe('call');
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].logicalCategory).toBe('form');
  });
});

describe('resolveStrategyWithCatalog', () => {
  const bc = { goals: { primary: 'both' }, confirmedAt: new Date() };

  it('returns allSlotsFilled true when every slot is matched', () => {
    const catalog = [
      { externalId: '1', resourceName: 'a/1', logicalCategory: 'call', status: 'ENABLED' },
      { externalId: '2', resourceName: 'a/2', logicalCategory: 'form', status: 'ENABLED' },
    ];

    const result = resolveStrategyWithCatalog(bc, catalog);
    expect(result.allSlotsFilled).toBe(true);
    expect(result.matchedCount).toBe(2);
    expect(result.unmatchedCount).toBe(0);
    expect(result.strategy.requiredSlots.every((s) => s.resolution === 'existing')).toBe(true);
  });

  it('returns partial fill summary when one slot is missing', () => {
    const catalog = [
      { externalId: '2', resourceName: 'a/2', logicalCategory: 'form', status: 'ENABLED' },
    ];

    const result = resolveStrategyWithCatalog(bc, catalog);
    expect(result.allSlotsFilled).toBe(false);
    expect(result.matchedCount).toBe(1);
    expect(result.unmatchedCount).toBe(1);
    expect(result.unmatchedSlots).toEqual(['call']);

    const callSlot = result.strategy.requiredSlots.find((s) => s.slot === 'call');
    const formSlot = result.strategy.requiredSlots.find((s) => s.slot === 'form');
    expect(callSlot.resolution).toBe('pending');
    expect(formSlot.resolution).toBe('existing');
  });

  it('marks all slots pending when catalog is empty', () => {
    const result = resolveStrategyWithCatalog(bc, []);
    expect(result.allSlotsFilled).toBe(false);
    expect(result.matchedCount).toBe(0);
    expect(result.unmatchedCount).toBe(2);
    expect(result.strategy.requiredSlots.every((s) => s.resolution === 'pending')).toBe(true);
  });
});

describe('createConversionActionForSlot', () => {
  const logger = createLogger({ level: 'silent' });

  async function seedRun() {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');

    const user = await User.create({ email: 'ca-create@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      goals: { primary: 'calls' },
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });
    return { bc, run };
  }

  const callSlot = {
    slot: 'call',
    logicalCategory: 'call',
    required: true,
    resolution: 'pending',
    externalId: null,
    resourceName: null,
  };

  beforeEach(() => {
    process.env.GOOGLE_ADS_API_MOCK = 'true';
    delete process.env.GOOGLE_ADS_CONVERSION_ACTION_CREATION_ENABLED;
  });

  it('reuses existing artifact without creating again', async () => {
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const { bc, run } = await seedRun();
    const idempotencyKey = adsConversionActionCreationIdempotencyKey(run._id, 'call');

    await IntegrationArtifact.create({
      businessId: bc.businessId,
      setupRunId: run._id,
      provider: 'google_ads',
      artifactType: 'ads_conversion_action_created',
      externalId: 'existing-9001',
      idempotencyKey,
      metadata: {
        resourceName: 'customers/123/conversionActions/existing-9001',
        source: 'google_ads_api_mock',
      },
    });

    const result = await createConversionActionForSlot({
      setupRunId: run._id,
      businessId: bc.businessId,
      customerId: '1234567890',
      slot: callSlot,
      logger,
    });

    expect(result.idempotent).toBe(true);
    expect(result.externalId).toBe('existing-9001');
    expect(result.resolution).toBe('create');
    expect(await IntegrationArtifact.countDocuments({ idempotencyKey })).toBe(1);
  });

  it('creates and persists artifact in mock mode', async () => {
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const { bc, run } = await seedRun();

    const result = await createConversionActionForSlot({
      setupRunId: run._id,
      businessId: bc.businessId,
      customerId: '1234567890',
      slot: callSlot,
      logger,
    });

    expect(result.resolution).toBe('create');
    expect(result.source).toBe('google_ads_api_mock');
    expect(result.externalId).toContain('mock-ca-');

    const artifact = await IntegrationArtifact.findOne({
      setupRunId: run._id,
      businessId: bc.businessId,
      artifactType: 'ads_conversion_action_created',
      externalId: result.externalId,
    }).lean();
    expect(artifact).toBeTruthy();
    expect(artifact.metadata.logicalCategory).toBe('call');
  });

  it('throws when no template exists for logicalCategory', async () => {
    const { bc, run } = await seedRun();

    await expect(
      createConversionActionForSlot({
        setupRunId: run._id,
        businessId: bc.businessId,
        customerId: '1234567890',
        slot: {
          slot: 'unknown',
          logicalCategory: 'unknown',
          required: true,
          resolution: 'pending',
          externalId: null,
          resourceName: null,
        },
        logger,
      })
    ).rejects.toBeInstanceOf(ConversionActionTemplateError);
  });
});

describe('fillUnmatchedSlots', () => {
  const logger = createLogger({ level: 'silent' });

  async function seedRun() {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');

    const user = await User.create({ email: 'ca-fill@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      goals: { primary: 'both' },
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });
    return { bc, run };
  }

  const unmatchedSlots = [
    {
      slot: 'call',
      logicalCategory: 'call',
      required: true,
      resolution: 'pending',
      externalId: null,
      resourceName: null,
    },
    {
      slot: 'form',
      logicalCategory: 'form',
      required: true,
      resolution: 'pending',
      externalId: null,
      resourceName: null,
    },
  ];

  beforeEach(() => {
    process.env.GOOGLE_ADS_API_MOCK = 'true';
    delete process.env.GOOGLE_ADS_CONVERSION_ACTION_CREATION_ENABLED;
  });

  it('skips creation when feature flag is disabled', async () => {
    const { bc, run } = await seedRun();

    const result = await fillUnmatchedSlots({
      setupRunId: run._id,
      businessId: bc.businessId,
      customerId: '1234567890',
      unmatchedSlots,
      logger,
    });

    expect(result.creationEnabled).toBe(false);
    expect(result.created).toHaveLength(0);
    expect(result.skipped).toEqual(['call', 'form']);
  });

  it('creates actions for unmatched slots when flag enabled', async () => {
    process.env.GOOGLE_ADS_CONVERSION_ACTION_CREATION_ENABLED = 'true';
    const { bc, run } = await seedRun();

    const result = await fillUnmatchedSlots({
      setupRunId: run._id,
      businessId: bc.businessId,
      customerId: '1234567890',
      unmatchedSlots,
      logger,
    });

    expect(result.creationEnabled).toBe(true);
    expect(result.created).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
    expect(result.created.map((row) => row.slot).sort()).toEqual(['call', 'form']);
  });

  it('continues when one slot fails template resolution', async () => {
    process.env.GOOGLE_ADS_CONVERSION_ACTION_CREATION_ENABLED = 'true';
    const { bc, run } = await seedRun();

    const result = await fillUnmatchedSlots({
      setupRunId: run._id,
      businessId: bc.businessId,
      customerId: '1234567890',
      unmatchedSlots: [
        unmatchedSlots[0],
        {
          slot: 'bad',
          logicalCategory: 'unknown',
          required: true,
          resolution: 'pending',
          externalId: null,
          resourceName: null,
        },
      ],
      logger,
    });

    expect(result.created).toHaveLength(1);
    expect(result.created[0].slot).toBe('call');
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].slot).toBe('bad');
    expect(result.failed[0].errorCode).toBe('CONVERSION_ACTION_NO_TEMPLATE');
  });
});

describe('manageConversionActions', () => {
  const logger = createLogger({ level: 'silent' });

  async function seedRun(opts = {}) {
    const User = mongoose.model('User');
    const BusinessContext = mongoose.model('BusinessContext');
    const SetupRun = mongoose.model('SetupRun');
    const IntegrationConnection = mongoose.model('IntegrationConnection');

    const user = await User.create({ email: opts.email ?? 'ca-manage@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      goals: 'goals' in opts ? opts.goals : { primary: 'both' },
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'RUNNING' });

    await connectGoogleIntegrations(bc.businessId, { customerId: '1234567890' });

    if (opts.mockConversionActions) {
      await IntegrationConnection.updateOne(
        { businessId: bc.businessId, provider: 'google_ads' },
        { $set: { 'providerIdentifiers.mockConversionActions': opts.mockConversionActions } }
      );
    }

    return { bc, run };
  }

  beforeEach(() => {
    process.env.GOOGLE_ADS_API_MOCK = 'true';
    delete process.env.GOOGLE_ADS_CONVERSION_ACTION_CREATION_ENABLED;
  });

  it('returns ok when all required slots are matched from catalog', async () => {
    const { bc, run } = await seedRun();

    const result = await manageConversionActions({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(result.outcome).toBe('ok');
    expect(result.slotsResolved).toBe(2);
    expect(result.reused).toBe(2);
    expect(result.created).toBe(0);
    expect(result.strategy.requiredSlots.every((slot) => slot.resolution === 'existing')).toBe(
      true
    );
  });

  it('returns missing_goal_data when goals are absent', async () => {
    const { bc, run } = await seedRun({ goals: null });

    const result = await manageConversionActions({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(result.outcome).toBe('missing_goal_data');
  });

  it('returns manual_review when creation is disabled and slots remain pending', async () => {
    const { bc, run } = await seedRun({
      mockConversionActions: [
        {
          id: '1002',
          name: 'Website form submit',
          category: 'SUBMIT_LEAD_FORM',
          status: 'ENABLED',
          type: 'WEBPAGE',
          includeInConversionsMetric: true,
        },
      ],
    });

    const result = await manageConversionActions({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(result.outcome).toBe('manual_review');
    expect(result.message).toContain('disabled');
    const callSlot = result.strategy.requiredSlots.find((slot) => slot.slot === 'call');
    expect(callSlot.resolution).toBe('pending');
  });

  it('returns ok and creates missing slots when creation flag is enabled', async () => {
    process.env.GOOGLE_ADS_CONVERSION_ACTION_CREATION_ENABLED = 'true';
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const { bc, run } = await seedRun({
      mockConversionActions: [
        {
          id: '1002',
          name: 'Website form submit',
          category: 'SUBMIT_LEAD_FORM',
          status: 'ENABLED',
          type: 'WEBPAGE',
          includeInConversionsMetric: true,
        },
      ],
    });

    const result = await manageConversionActions({
      setupRunId: run._id,
      businessId: bc.businessId,
      logger,
    });

    expect(result.outcome).toBe('ok');
    expect(result.created).toBe(1);
    expect(result.reused).toBe(1);
    expect(
      await IntegrationArtifact.countDocuments({
        setupRunId: run._id,
        artifactType: 'ads_conversion_action_created',
      })
    ).toBe(1);
  });
});
