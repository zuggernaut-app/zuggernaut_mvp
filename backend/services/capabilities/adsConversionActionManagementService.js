'use strict';

/**
 * Conversion Action Management Service
 *
 * Phase 2: deriveConversionStrategy + persistConversionStrategy (read-only derivation).
 * Phase 3: matchSlotsToExistingActions + resolveStrategyWithCatalog (idempotent discovery/reuse).
 * Phase 4: createConversionActionForSlot + fillUnmatchedSlots (creation behind feature flag).
 * Phase 5: manageConversionActions (workflow integration orchestrator).
 */

const mongoose = require('mongoose');
const {
  CONVERSION_SLOTS_BY_GOAL,
  DEFAULT_CONVERSION_ACTION_TEMPLATES,
} = require('../../constants/conversionActionRequirements');
const { adsConversionActionCreationIdempotencyKey } = require('../../constants/idempotency');
const { isConversionActionCreationEnabled } = require('../integrations/googleAdsApiConfig');
const { createConversionAction } = require('../integrations/googleAdsConversionActionClient');
const { resolvePrimaryGoal, sortForSelection } = require('./adsConversionCatalogService');
const {
  claimConversionActionCreation,
  finalizeConversionActionCreation,
  markConversionActionCreationFailed,
  findCreatedConversionArtifact,
  recoverOwnedConversionAction,
  isOwnedNameRecoverableError,
  ConversionActionClaimError,
} = require('./conversionActionCreationClaim');
const { zugConversionActionName } = require('../../lib/businessNameKey');

const { requireSetupReadyConnection } = require('./setupReadyConnectionService');
const BusinessContext = mongoose.model('BusinessContext');
const IntegrationArtifact = mongoose.model('IntegrationArtifact');

class ConversionActionManagementError extends Error {
  constructor(message, code = 'CONVERSION_ACTION_MANAGEMENT_ERROR') {
    super(message);
    this.name = 'ConversionActionManagementError';
    this.code = code;
  }
}

class ConversionActionTemplateError extends Error {
  constructor(message, code = 'CONVERSION_ACTION_NO_TEMPLATE') {
    super(message);
    this.name = 'ConversionActionTemplateError';
    this.code = code;
  }
}

/**
 * @param {object} slot — entry from CONVERSION_SLOTS_BY_GOAL
 * @returns {object}
 */
function toPendingSlot(slot) {
  return {
    slot: slot.slot,
    logicalCategory: slot.logicalCategory,
    required: slot.required,
    resolution: 'pending',
    externalId: null,
    resourceName: null,
  };
}

/**
 * @param {object} slot
 * @param {object} action — catalog action with logicalCategory
 * @returns {object}
 */
function toMatchedSlot(slot, action) {
  return {
    slot: slot.slot,
    logicalCategory: slot.logicalCategory,
    required: slot.required,
    resolution: 'existing',
    externalId: action.externalId ?? null,
    resourceName: action.resourceName ?? null,
  };
}

/**
 * @param {object} slot
 * @param {{ externalId: string, resourceName: string, source: string }} created
 * @returns {object}
 */
function toCreatedSlot(slot, created) {
  return {
    slot: slot.slot,
    logicalCategory: slot.logicalCategory,
    required: slot.required,
    resolution: 'create',
    externalId: created.externalId,
    resourceName: created.resourceName,
  };
}

/**
 * @param {object | null | undefined} goals
 * @param {Date | null | undefined} confirmedAt
 * @returns {'scrape_goals'|'user_confirmed_goals'|'default'}
 */
function resolveDerivedFrom(goals, confirmedAt) {
  if (goals == null) return 'default';
  if (confirmedAt != null) return 'user_confirmed_goals';
  return 'scrape_goals';
}

/**
 * Derives the required conversion action slots from the BusinessContext.
 *
 * @param {object} businessContext — lean BusinessContext document
 * @returns {import('../../models/BusinessContext').ConversionStrategy}
 */
function deriveConversionStrategy(businessContext) {
  const goals = businessContext?.goals ?? null;
  const resolvedPrimaryGoal = resolvePrimaryGoal(goals);
  const slotDefs = CONVERSION_SLOTS_BY_GOAL[resolvedPrimaryGoal];

  return {
    resolvedPrimaryGoal,
    requiredSlots: slotDefs.map(toPendingSlot),
    derivedFrom: resolveDerivedFrom(goals, businessContext?.confirmedAt),
    derivedAt: new Date().toISOString(),
  };
}

/**
 * Matches existing conversion actions (from the catalog) to required slots.
 * Returns unmatched slots that need creation.
 *
 * @param {object[]} requiredSlots — from deriveConversionStrategy
 * @param {object[]} catalogActions — normalized actions with logicalCategory
 * @returns {{ matched: object[], unmatched: object[] }}
 */
function matchSlotsToExistingActions(requiredSlots, catalogActions) {
  const pool = [...(catalogActions ?? [])];
  const matched = [];
  const unmatched = [];

  for (const slot of requiredSlots ?? []) {
    const candidates = pool.filter((a) => a.logicalCategory === slot.logicalCategory);
    const best = sortForSelection(candidates)[0];

    if (!best) {
      unmatched.push({
        slot: slot.slot,
        logicalCategory: slot.logicalCategory,
        required: slot.required,
        resolution: 'pending',
        externalId: null,
        resourceName: null,
      });
      continue;
    }

    const idx = pool.indexOf(best);
    if (idx >= 0) pool.splice(idx, 1);
    matched.push(toMatchedSlot(slot, best));
  }

  return { matched, unmatched };
}

/**
 * Derives strategy and resolves slots against a classified catalog (pure).
 *
 * @param {object} businessContext — lean BusinessContext document
 * @param {object[]} classifiedCatalog — actions with logicalCategory
 * @returns {{
 *   strategy: object,
 *   allSlotsFilled: boolean,
 *   matchedCount: number,
 *   unmatchedCount: number,
 *   unmatchedSlots: string[],
 * }}
 */
function resolveStrategyWithCatalog(businessContext, classifiedCatalog) {
  const strategy = deriveConversionStrategy(businessContext);
  const { matched, unmatched } = matchSlotsToExistingActions(
    strategy.requiredSlots,
    classifiedCatalog
  );

  const resolvedBySlot = new Map([
    ...matched.map((s) => [s.slot, s]),
    ...unmatched.map((s) => [s.slot, s]),
  ]);

  const requiredSlots = strategy.requiredSlots.map(
    (slot) => resolvedBySlot.get(slot.slot) ?? slot
  );

  return {
    strategy: {
      ...strategy,
      requiredSlots,
    },
    allSlotsFilled: unmatched.length === 0,
    matchedCount: matched.length,
    unmatchedCount: unmatched.length,
    unmatchedSlots: unmatched.map((s) => s.slot),
  };
}

/**
 * @param {object} ctx
 */
async function findExistingCreatedConversionArtifact(ctx) {
  const { setupRunId, businessId, slot } = ctx;
  const idempotencyKey = adsConversionActionCreationIdempotencyKey(setupRunId, slot.slot);
  return findCreatedConversionArtifact({ setupRunId, businessId, idempotencyKey });
}

/**
 * @param {object} ctx
 */
async function persistCreatedConversionArtifact(ctx) {
  const { setupRunId, businessId, slot, externalId, resourceName, source, template, measurement } = ctx;
  await finalizeConversionActionCreation({
    setupRunId,
    businessId,
    slot,
    externalId,
    resourceName,
    source,
    template,
    measurement,
  });
}

/**
 * Creates a Google Ads conversion action for an unmatched slot.
 *
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId | string} ctx.setupRunId
 * @param {string} ctx.customerId
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 * @param {object} ctx.slot — the unmatched slot requirement
 * @param {import('pino').Logger} [ctx.logger]
 * @returns {Promise<{ externalId: string, resourceName: string, source: string, resolution: string, idempotent?: boolean }>}
 */
async function createConversionActionForSlot(ctx) {
  const { setupRunId, businessId, customerId, slot, logger } = ctx;

  const baseTemplate = DEFAULT_CONVERSION_ACTION_TEMPLATES[slot.logicalCategory];
  if (!baseTemplate) {
    throw new ConversionActionTemplateError(
      `No conversion action template for logicalCategory "${slot.logicalCategory}".`
    );
  }

  const bc = await BusinessContext.findOne({ businessId }).select('nameKey').lean();
  const customName = zugConversionActionName(bc?.nameKey, slot.logicalCategory);
  const template = {
    ...baseTemplate,
    ...(customName ? { name: customName } : {}),
  };

  const idempotencyKey = adsConversionActionCreationIdempotencyKey(setupRunId, slot.slot);
  const existing = await findExistingCreatedConversionArtifact(ctx);
  if (existing) {
    logger?.info?.(
      {
        setupRunId: String(setupRunId),
        businessId: String(businessId),
        slot: slot.slot,
        externalId: existing.externalId,
      },
      'conversion action creation reused existing artifact'
    );
    return {
      externalId: existing.externalId,
      resourceName: existing.metadata?.resourceName ?? null,
      source: existing.metadata?.source ?? 'google_ads_api',
      resolution: 'create',
      idempotent: true,
    };
  }

  const claim = await claimConversionActionCreation({
    setupRunId,
    businessId,
    slot,
    idempotencyKey,
    template,
  });
  if (!claim.claimed && claim.idempotent && claim.artifact) {
    return {
      externalId: claim.artifact.externalId,
      resourceName: claim.artifact.metadata?.resourceName ?? null,
      source: claim.artifact.metadata?.source ?? 'google_ads_api',
      resolution: 'create',
      idempotent: true,
    };
  }

  let created;
  try {
    created = await createConversionAction({
      businessId,
      customerId,
      conversionActionConfig: template,
      idempotencyKey,
    });
  } catch (err) {
    if (
      err instanceof ConversionActionClaimError &&
      err.code === 'CONVERSION_ACTION_CLAIM_IN_PROGRESS'
    ) {
      throw err;
    }

    await markConversionActionCreationFailed({
      setupRunId,
      businessId,
      slot,
      errorCode: err instanceof Error && err.code ? err.code : 'CONVERSION_ACTION_CREATE_FAILED',
      errorMessage: err instanceof Error ? err.message : 'conversion action creation failed',
    });

    if (isOwnedNameRecoverableError(err)) {
      const { fetchGoogleAdsConversionCatalog } = require('../integrations/googleAdsConversionCatalogClient');
      try {
        const catalog = await fetchGoogleAdsConversionCatalog({ businessId, customerId, logger });
        const owned = recoverOwnedConversionAction(
          catalog.conversionActions,
          slot.logicalCategory,
          template.name
        );
        if (owned) {
          created = {
            externalId: owned.externalId,
            resourceName: owned.resourceName,
            source: 'google_ads_api_owned_name_reconcile',
            idempotencyKey,
            conversionId: owned.conversionId,
            conversionLabel: owned.conversionLabel,
            tagSnippets: owned.tagSnippets,
          };
        } else {
          throw err;
        }
      } catch (reconcileErr) {
        if (reconcileErr === err) throw err;
        throw err;
      }
    } else {
      throw err;
    }
  }

  const measurement =
    created.conversionId && created.conversionLabel
      ? {
          conversionId: created.conversionId,
          conversionLabel: created.conversionLabel,
          ...(created.tagSnippets ? { tagSnippets: created.tagSnippets } : {}),
        }
      : null;

  await persistCreatedConversionArtifact({
    setupRunId,
    businessId,
    slot,
    externalId: created.externalId,
    resourceName: created.resourceName,
    source: created.source,
    template,
    measurement,
  });

  logger?.info?.(
    {
      setupRunId: String(setupRunId),
      businessId: String(businessId),
      slot: slot.slot,
      externalId: created.externalId,
      source: created.source,
    },
    'conversion action created for slot'
  );

  return {
    externalId: created.externalId,
    resourceName: created.resourceName,
    source: created.source,
    resolution: 'create',
    ...(created.idempotent ? { idempotent: true } : {}),
  };
}

/**
 * Creates conversion actions for unmatched slots when the feature flag is enabled.
 *
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId | string} ctx.setupRunId
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 * @param {string} ctx.customerId
 * @param {object[]} ctx.unmatchedSlots
 * @param {import('pino').Logger} [ctx.logger]
 * @returns {Promise<{ created: object[], failed: object[], skipped: string[], creationEnabled: boolean }>}
 */
async function fillUnmatchedSlots(ctx) {
  const { unmatchedSlots, logger } = ctx;

  if (!isConversionActionCreationEnabled()) {
    return {
      created: [],
      failed: [],
      skipped: (unmatchedSlots ?? []).map((s) => s.slot),
      creationEnabled: false,
    };
  }

  const created = [];
  const failed = [];

  for (const slot of unmatchedSlots ?? []) {
    try {
      const result = await createConversionActionForSlot({ ...ctx, slot });
      created.push({
        slot: slot.slot,
        logicalCategory: slot.logicalCategory,
        ...result,
      });
    } catch (err) {
      if (
        err instanceof ConversionActionClaimError &&
        err.code === 'CONVERSION_ACTION_CLAIM_IN_PROGRESS'
      ) {
        throw err;
      }

      const message = err instanceof Error ? err.message : 'conversion action creation failed';
      const errorCode = err instanceof Error && err.code ? err.code : 'CONVERSION_ACTION_CREATE_FAILED';
      logger?.warn?.(
        {
          setupRunId: String(ctx.setupRunId),
          businessId: String(ctx.businessId),
          slot: slot.slot,
          error: message,
          errorCode,
        },
        'conversion action creation failed for slot'
      );
      failed.push({
        slot: slot.slot,
        logicalCategory: slot.logicalCategory,
        message,
        errorCode,
      });
    }
  }

  return {
    created,
    failed,
    skipped: [],
    creationEnabled: true,
  };
}

/**
 * Persists a derived conversion strategy on BusinessContext.
 *
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {object} conversionStrategy
 * @param {import('pino').Logger} [logger]
 * @returns {Promise<object|null>}
 */
async function persistConversionStrategy(businessId, conversionStrategy, logger) {
  const doc = await BusinessContext.findOneAndUpdate(
    { businessId },
    { $set: { conversionStrategy } },
    { returnDocument: 'after' }
  ).lean();

  if (doc) {
    logger?.info?.(
      {
        businessId: String(businessId),
        resolvedPrimaryGoal: conversionStrategy.resolvedPrimaryGoal,
        slotCount: conversionStrategy.requiredSlots?.length ?? 0,
        derivedFrom: conversionStrategy.derivedFrom,
      },
      'conversion strategy derived'
    );
  }

  return doc;
}

/**
 * @param {object | null | undefined} goals
 * @returns {boolean}
 */
function hasDerivableGoals(goals) {
  if (goals == null) return false;
  const primary = goals.primary;
  return primary != null && String(primary).trim() !== '';
}

/**
 * Top-level orchestrator: load context → fetch catalog → match → create → persist strategy.
 *
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId} ctx.setupRunId
 * @param {import('mongoose').Types.ObjectId} ctx.businessId
 * @param {import('pino').Logger} [ctx.logger]
 * @returns {Promise<{
 *   outcome: 'ok' | 'missing_goal_data' | 'creation_failed' | 'manual_review',
 *   message?: string,
 *   errorCode?: string,
 *   slotsResolved?: number,
 *   created?: number,
 *   reused?: number,
 *   strategy?: object,
 * }>}
 */
async function manageConversionActions(ctx) {
  const { setupRunId, businessId, logger } = ctx;

  const bc = await BusinessContext.findOne({ businessId }).lean();
  if (!bc) {
    return {
      outcome: 'missing_goal_data',
      message: 'BusinessContext not found for conversion action management.',
    };
  }

  if (!hasDerivableGoals(bc.goals)) {
    return {
      outcome: 'missing_goal_data',
      message: 'Business goals are required to derive conversion strategy.',
    };
  }

  let customerId;
  try {
    ({ customerId } = await requireSetupReadyConnection(
      businessId,
      'google_ads',
      ConversionActionManagementError
    ));
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Google Ads connection not ready';
    const errorCode =
      err instanceof Error && err.code ? err.code : 'GOOGLE_ADS_CONNECTION_NOT_READY';
    return { outcome: 'creation_failed', message, errorCode };
  }

  let readModel;
  try {
    const { fetchGoogleAdsConversionCatalog } = require('../integrations/googleAdsConversionCatalogClient');
    readModel = await fetchGoogleAdsConversionCatalog({ businessId, customerId, logger });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Google Ads catalog read failed';
    const errorCode =
      err instanceof Error && err.code ? err.code : 'GOOGLE_ADS_CATALOG_READ_FAILED';
    return { outcome: 'creation_failed', message, errorCode };
  }

  const { classifyConversionAction } = require('./adsConversionCatalogService');
  const catalog = readModel.conversionActions.map((action) => ({
    ...action,
    logicalCategory: classifyConversionAction(action),
  }));

  const resolution = resolveStrategyWithCatalog(bc, catalog);

  let fillResult = { created: [], failed: [], skipped: [], creationEnabled: true };
  if (resolution.unmatchedCount > 0) {
    const unmatchedSlotObjects = resolution.strategy.requiredSlots.filter(
      (slot) => slot.resolution === 'pending'
    );
    fillResult = await fillUnmatchedSlots({
      setupRunId,
      businessId,
      customerId,
      unmatchedSlots: unmatchedSlotObjects,
      logger,
    });
  }

  const createdBySlot = new Map(fillResult.created.map((row) => [row.slot, row]));
  const requiredSlots = resolution.strategy.requiredSlots.map((slot) => {
    if (slot.resolution !== 'pending') return slot;
    const created = createdBySlot.get(slot.slot);
    if (created) {
      return toCreatedSlot(slot, created);
    }
    return slot;
  });

  const finalStrategy = {
    ...resolution.strategy,
    requiredSlots,
  };

  await persistConversionStrategy(businessId, finalStrategy, logger);

  const reused = requiredSlots.filter((slot) => slot.resolution === 'existing').length;
  const created = requiredSlots.filter((slot) => slot.resolution === 'create').length;
  const pendingRequired = requiredSlots.filter(
    (slot) => slot.resolution === 'pending' && slot.required
  );

  if (pendingRequired.length === 0) {
    return {
      outcome: 'ok',
      slotsResolved: requiredSlots.length,
      created,
      reused,
      strategy: finalStrategy,
    };
  }

  if (fillResult.failed.length > 0) {
    const first = fillResult.failed[0];
    return {
      outcome: 'creation_failed',
      message: first.message ?? 'Conversion action creation failed for required slots.',
      errorCode: first.errorCode ?? 'CONVERSION_ACTION_CREATE_FAILED',
      strategy: finalStrategy,
      created,
      reused,
    };
  }

  if (!fillResult.creationEnabled) {
    return {
      outcome: 'manual_review',
      message: 'Conversion action creation is disabled and required slots are unfilled.',
      strategy: finalStrategy,
    };
  }

  return {
    outcome: 'manual_review',
    message: 'Required conversion action slots remain unresolved.',
    strategy: finalStrategy,
  };
}

module.exports = {
  ConversionActionManagementError,
  ConversionActionTemplateError,
  deriveConversionStrategy,
  matchSlotsToExistingActions,
  resolveStrategyWithCatalog,
  createConversionActionForSlot,
  fillUnmatchedSlots,
  persistConversionStrategy,
  manageConversionActions,
  toCreatedSlot,
};
