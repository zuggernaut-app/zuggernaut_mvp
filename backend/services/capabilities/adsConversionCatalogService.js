'use strict';

const mongoose = require('mongoose');
const { SETUP_STEP_NAMES } = require('../../constants/setupWorkflow');
const { adsConversionCatalogIdempotencyKey } = require('../../constants/idempotency');
const { conversionMeasurementFromAction } = require('../../lib/googleAdsConversionTagSnippets');
const { fetchGoogleAdsConversionCatalog } = require('../integrations/googleAdsConversionCatalogClient');
const { requireSetupReadyConnection } = require('./setupReadyConnectionService');
const ProviderSnapshot = mongoose.model('ProviderSnapshot');
const IntegrationArtifact = mongoose.model('IntegrationArtifact');
const BusinessContext = mongoose.model('BusinessContext');

class AdsCatalogPreconditionError extends Error {
  constructor(message, code = 'ADS_CATALOG_PRECONDITION') {
    super(message);
    this.name = 'AdsCatalogPreconditionError';
    this.code = code;
  }
}

const CALL_CATEGORIES = new Set(['PHONE_CALL_LEAD']);
const CALL_TYPES = new Set(['PHONE_CALL_FROM_ADS', 'AD_CALL', 'CLICK_TO_CALL']);
const FORM_CATEGORIES = new Set([
  'SUBMIT_LEAD_FORM',
  'SIGNUP',
  'CONTACT',
  'BOOK_APPOINTMENT',
  'REQUEST_QUOTE',
]);

/**
 * Deterministic logical category for V1 selection: call | form | other.
 * @param {object} action — normalized conversion action
 */
function classifyConversionAction(action) {
  const category = String(action.category ?? '').toUpperCase();
  const type = String(action.type ?? '').toUpperCase();
  const name = String(action.name ?? '').toLowerCase();

  if (CALL_CATEGORIES.has(category) || CALL_TYPES.has(type)) return 'call';
  if (FORM_CATEGORIES.has(category)) return 'form';
  if (type === 'WEBPAGE' && /form|submit|lead|signup|contact|inquiry|quote/.test(name)) return 'form';
  if (/call|phone|tel/.test(name)) return 'call';
  if (/form|submit|lead|signup|contact|inquiry|quote/.test(name)) return 'form';
  return 'other';
}

/**
 * @param {object | null | undefined} goals
 * @returns {'calls' | 'forms' | 'both'}
 */
function resolvePrimaryGoal(goals) {
  const raw = goals?.primary;
  if (raw == null || raw === '') return 'both';
  const p = String(raw).toLowerCase();
  if (p === 'calls' || p === 'call') return 'calls';
  if (p === 'forms' || p === 'form' || p === 'leads' || p === 'lead') return 'forms';
  if (p === 'both') return 'both';
  return 'both';
}

/**
 * @param {object} action
 */
function conversionRankScore(action) {
  let score = 0;
  if (String(action.status ?? '').toUpperCase() === 'ENABLED') score += 100;
  if (action.includeInConversionsMetric === true) score += 50;
  return score;
}

/**
 * @param {object[]} actions
 */
function sortForSelection(actions) {
  return [...actions].sort((a, b) => {
    const diff = conversionRankScore(b) - conversionRankScore(a);
    if (diff !== 0) return diff;
    return String(a.resourceName ?? a.externalId).localeCompare(
      String(b.resourceName ?? b.externalId)
    );
  });
}

/**
 * GTM awct tags require tag-snippet-derived conversionId + conversionLabel.
 *
 * @param {object} action
 */
function hasGtmBindableMeasurement(action) {
  return Boolean(conversionMeasurementFromAction(action));
}

/**
 * @param {object[]} actions
 */
function selectBindableConversionActions(actions) {
  return sortForSelection(actions.filter((action) => hasGtmBindableMeasurement(action)));
}

/**
 * @param {'call' | 'form'} logicalCategory
 * @param {object[]} allInCategory
 * @param {object[]} bindableInCategory
 * @param {string} primaryGoalLabel
 */
function assertBindableConversionActionSelected(
  logicalCategory,
  allInCategory,
  bindableInCategory,
  primaryGoalLabel
) {
  if (bindableInCategory[0]) return bindableInCategory[0];

  const slotLabel = logicalCategory === 'call' ? 'call' : 'form';
  const missingCode =
    logicalCategory === 'call' ? 'ADS_CATALOG_MISSING_CALL' : 'ADS_CATALOG_MISSING_FORM';

  if (allInCategory.length === 0) {
    throw new AdsCatalogPreconditionError(
      `No ${slotLabel} conversion action available for primary goal "${primaryGoalLabel}".`,
      missingCode
    );
  }

  const example = allInCategory[0];
  throw new AdsCatalogPreconditionError(
    `Selected ${slotLabel} conversion action "${example.name ?? example.externalId}" (${example.externalId}) lacks GTM-bindable measurement (conversionId/conversionLabel from tag snippets). Choose a different conversion action in Google Ads or create a webpage conversion with tag snippets.`,
    'ADS_CONVERSION_MEASUREMENT_MISSING'
  );
}

/**
 * @param {object[]} catalog — normalized actions with logicalCategory
 * @param {'calls' | 'forms' | 'both'} primaryGoal
 */
function selectConversionActions(catalog, primaryGoal) {
  const allCalls = catalog.filter((a) => a.logicalCategory === 'call');
  const allForms = catalog.filter((a) => a.logicalCategory === 'form');
  const calls = selectBindableConversionActions(allCalls);
  const forms = selectBindableConversionActions(allForms);

  const selected = [];

  if (primaryGoal === 'calls') {
    selected.push(assertBindableConversionActionSelected('call', allCalls, calls, 'calls'));
  } else if (primaryGoal === 'forms') {
    selected.push(assertBindableConversionActionSelected('form', allForms, forms, 'forms'));
  } else {
    selected.push(
      assertBindableConversionActionSelected('call', allCalls, calls, 'both'),
      assertBindableConversionActionSelected('form', allForms, forms, 'both')
    );
  }

  return selected;
}

/**
 * @param {object[]} selected
 */
function buildCatalogSummary(catalog, selected, primaryGoal, source) {
  const callCount = catalog.filter((a) => a.logicalCategory === 'call').length;
  const formCount = catalog.filter((a) => a.logicalCategory === 'form').length;
  return {
    primaryGoal,
    source,
    totalInCatalog: catalog.length,
    callCount,
    formCount,
    selectedCount: selected.length,
    selectedCategories: selected.map((a) => a.logicalCategory),
  };
}

/**
 * Fetches, normalizes, persists full catalog snapshot, and upserts selected conversion IntegrationArtifacts.
 *
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId} ctx.setupRunId
 * @param {import('mongoose').Types.ObjectId} ctx.businessId
 * @param {import('pino').Logger} ctx.logger
 */
async function fetchAndPersistConversionCatalog(ctx) {
  const { setupRunId, businessId, logger } = ctx;

  const bc = await BusinessContext.findOne({ businessId }).lean();
  if (!bc) {
    throw new AdsCatalogPreconditionError('BusinessContext missing for Ads catalog.');
  }

  const { customerId } = await requireSetupReadyConnection(
    businessId,
    'google_ads',
    AdsCatalogPreconditionError
  );

  let readModel;
  try {
    readModel = await fetchGoogleAdsConversionCatalog({ businessId, customerId, logger });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Google Ads catalog read failed';
    const code = err instanceof Error && err.code ? err.code : 'GOOGLE_ADS_CATALOG_READ_FAILED';
    throw new AdsCatalogPreconditionError(msg, code);
  }

  const catalog = readModel.conversionActions.map((action) => ({
    ...action,
    logicalCategory: classifyConversionAction(action),
  }));

  for (const action of catalog) {
    if (action.logicalCategory !== 'call' && action.logicalCategory !== 'form') {
      continue;
    }
    if (hasGtmBindableMeasurement(action)) {
      continue;
    }
    logger.warn(
      {
        operation: 'conversion_measurement_eligibility',
        setupRunId: setupRunId.toString(),
        businessId: businessId.toString(),
        externalId: action.externalId,
        logicalCategory: action.logicalCategory,
        type: action.type ?? null,
        category: action.category ?? null,
        hasConversionId: Boolean(action.conversionId),
        hasConversionLabel: Boolean(action.conversionLabel),
        tagSnippets: action.tagSnippets ?? null,
      },
      'Ads conversion action lacks GTM-bindable measurement'
    );
  }

  try {
    const {
      resolveStrategyWithCatalog,
      persistConversionStrategy,
    } = require('./adsConversionActionManagementService');
    const resolution = resolveStrategyWithCatalog(bc, catalog);
    await persistConversionStrategy(businessId, resolution.strategy, logger);
    logger.info(
      {
        setupRunId: setupRunId.toString(),
        businessId: businessId.toString(),
        stepName: SETUP_STEP_NAMES.ADS_CONVERSION_CATALOG,
        provider: 'google_ads',
        allSlotsFilled: resolution.allSlotsFilled,
        matchedCount: resolution.matchedCount,
        unmatchedCount: resolution.unmatchedCount,
        unmatchedSlots: resolution.unmatchedSlots,
      },
      'conversion strategy resolved against catalog'
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'conversion strategy resolution failed';
    logger.warn(
      {
        setupRunId: setupRunId.toString(),
        businessId: businessId.toString(),
        stepName: SETUP_STEP_NAMES.ADS_CONVERSION_CATALOG,
        error: msg,
      },
      'conversion strategy resolution failed'
    );
  }

  const primaryGoal = resolvePrimaryGoal(bc.goals);
  const selected = selectConversionActions(catalog, primaryGoal);
  const summary = buildCatalogSummary(catalog, selected, primaryGoal, readModel.source);

  const payload = {
    source: readModel.source,
    fetchedAt: readModel.recordedAt,
    customerId: readModel.customerId ?? null,
    goals: bc.goals ?? null,
    primaryGoal,
    conversionActions: catalog,
  };

  await ProviderSnapshot.findOneAndUpdate(
    {
      setupRunId,
      businessId,
      provider: 'google_ads',
      snapshotType: 'ads_conversion_catalog',
    },
    {
      $setOnInsert: { immutable: false, snapshotVersion: 1 },
      $set: { payload },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  for (const row of selected) {
    await IntegrationArtifact.findOneAndUpdate(
      {
        setupRunId,
        businessId,
        provider: 'google_ads',
        artifactType: 'ads_conversion_action',
        externalId: row.externalId,
      },
      {
        $setOnInsert: {
          idempotencyKey: adsConversionCatalogIdempotencyKey(setupRunId, row.logicalCategory),
        },
        $set: {
          metadata: {
            name: row.name,
            logicalCategory: row.logicalCategory,
            resourceName: row.resourceName,
            category: row.category,
            type: row.type,
            selectedBy: 'deterministic_rank_and_sort',
            primaryGoal,
            ...(row.conversionId ? { conversionId: row.conversionId } : {}),
            ...(row.conversionLabel ? { conversionLabel: row.conversionLabel } : {}),
            ...(row.tagSnippets ? { tagSnippets: row.tagSnippets } : {}),
          },
        },
      },
      { upsert: true, setDefaultsOnInsert: true }
    );
  }

  logger.info(
    {
      setupRunId: setupRunId.toString(),
      businessId: businessId.toString(),
      stepName: SETUP_STEP_NAMES.ADS_CONVERSION_CATALOG,
      provider: 'google_ads',
      ...summary,
    },
    'ads conversion catalog persisted'
  );

  return {
    selectedIds: selected.map((a) => a.externalId),
    summary,
    source: readModel.source,
  };
}

module.exports = {
  fetchAndPersistConversionCatalog,
  AdsCatalogPreconditionError,
  classifyConversionAction,
  resolvePrimaryGoal,
  selectConversionActions,
  sortForSelection,
  buildCatalogSummary,
};
