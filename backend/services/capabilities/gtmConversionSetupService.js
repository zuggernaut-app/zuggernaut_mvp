'use strict';

const mongoose = require('mongoose');
const { SETUP_STEP_NAMES } = require('../../constants/setupWorkflow');
const { gtmConversionIdempotencyKey } = require('../../constants/idempotency');
const { buildGtmSetupPlan } = require('./gtmTemplates/v1');
const { requireSetupReadyConnection, validateGtmIdentifiers } = require('./setupReadyConnectionService');
const {
  createGtmWorkspaceResource,
  createAndPublishContainerVersion,
  enableGtmBuiltinVariables,
  getGtmAccessToken,
} = require('../integrations/googleTagManagerClient');
const IntegrationArtifact = mongoose.model('IntegrationArtifact');
const ProviderSnapshot = mongoose.model('ProviderSnapshot');
const BusinessContext = mongoose.model('BusinessContext');

class GtmProviderPreconditionError extends Error {
  constructor(message, code = 'GTM_PROVIDER_PRECONDITION') {
    super(message);
    this.name = 'GtmProviderPreconditionError';
    this.code = code;
  }
}

/**
 * GTM tag payloads require numeric trigger IDs in firingTriggerId[], not full resource paths.
 *
 * @param {string | null | undefined} resourcePath
 * @returns {string | null}
 */
function gtmTriggerIdFromPath(resourcePath) {
  if (!resourcePath || typeof resourcePath !== 'string') return null;
  const match = resourcePath.match(/\/triggers\/(\d+)$/);
  return match ? match[1] : null;
}

/**
 * Click built-in types to enable before create_version.
 * create_version compiles the whole workspace, not just this run's plan.
 *
 * @param {object} _plan
 * @returns {string[]}
 */
function requiredClickBuiltinTypes(_plan) {
  return ['clickUrl', 'clickText', 'clickElement'];
}

/**
 * @param {import('mongoose').Types.ObjectId} setupRunId
 * @param {import('mongoose').Types.ObjectId} businessId
 * @param {string} logicalKey
 */
function gtmIdempotencyKey(setupRunId, logicalKey) {
  return gtmConversionIdempotencyKey(setupRunId, logicalKey);
}

/**
 * @param {object} ctx
 */
async function findExistingGtmArtifact(ctx) {
  const { setupRunId, businessId, logicalKey } = ctx;
  return IntegrationArtifact.findOne({
    setupRunId,
    businessId,
    provider: 'gtm',
    idempotencyKey: gtmIdempotencyKey(setupRunId, logicalKey),
  }).lean();
}

/**
 * @param {object} ctx
 */
async function persistGtmArtifact(ctx) {
  const { setupRunId, businessId, artifactType, logicalKey, externalId, metadata } = ctx;
  await IntegrationArtifact.findOneAndUpdate(
    {
      setupRunId,
      businessId,
      provider: 'gtm',
      artifactType,
      externalId,
    },
    {
      $setOnInsert: { idempotencyKey: gtmIdempotencyKey(setupRunId, logicalKey) },
      $set: { metadata },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );
}

/**
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId} ctx.setupRunId
 * @param {import('mongoose').Types.ObjectId} ctx.businessId
 * @param {import('pino').Logger} ctx.logger
 */
async function runGtmConversionSetup(ctx) {
  const { setupRunId, businessId, logger } = ctx;

  const conversionArtifacts = await IntegrationArtifact.find({
    setupRunId,
    businessId,
    provider: 'google_ads',
    artifactType: 'ads_conversion_action',
  }).lean();

  if (conversionArtifacts.length < 1) {
    throw new GtmProviderPreconditionError(
      'No Ads conversion artifacts to bind for GTM setup.',
      'GTM_MISSING_ADS_CONVERSIONS'
    );
  }

  const { gtmIds } = await requireSetupReadyConnection(
    businessId,
    'gtm',
    GtmProviderPreconditionError,
    { selectTokens: true }
  );

  if (process.env.GTM_API_MOCK !== 'true' && process.env.GTM_API_ENABLED !== 'true') {
    throw new GtmProviderPreconditionError(
      'GTM API is not enabled on this deployment (set GTM_API_ENABLED=true after wiring credentials).',
      'GTM_API_NOT_ENABLED'
    );
  }

  const { customerId: adsCustomerId } = await requireSetupReadyConnection(
    businessId,
    'google_ads',
    GtmProviderPreconditionError
  );

  const bc = await BusinessContext.findOne({ businessId }).lean();
  const plan = buildGtmSetupPlan({
    conversionArtifacts,
    adsCustomerId,
    websiteUrl: bc?.websiteUrl ?? null,
  });

  const accessToken = await getGtmAccessToken({ businessId });

  let variablesCreated = 0;
  let triggersCreated = 0;
  let tagsCreated = 0;
  let reusedArtifacts = 0;

  /** @type {Map<string, string>} logicalKey -> GTM resource path */
  const resourcePaths = new Map();

  const nonTagResources = plan.resources.filter((r) => r.kind !== 'tag');
  const tagResources = plan.resources.filter((r) => r.kind === 'tag');

  for (const spec of nonTagResources) {
    const collection = spec.kind === 'variable' ? 'variables' : 'triggers';
    const existing = await findExistingGtmArtifact({ setupRunId, businessId, logicalKey: spec.logicalKey });

    let resourcePath;
    if (existing) {
      resourcePath = existing.externalId;
      reusedArtifacts += 1;
    } else {
      const created = await createGtmWorkspaceResource({
        gtmIds,
        accessToken,
        collection,
        payload: spec.gtmPayload,
        logicalKey: spec.logicalKey,
      });
      resourcePath = created.resourcePath;
      if (spec.kind === 'variable') variablesCreated += 1;
      if (spec.kind === 'trigger') triggersCreated += 1;

      await persistGtmArtifact({
        setupRunId,
        businessId,
        artifactType: spec.artifactType,
        logicalKey: spec.logicalKey,
        externalId: resourcePath,
        metadata: {
          role: spec.kind,
          template: spec.template,
          templateVersion: plan.templateVersion,
          displayName: spec.displayName,
          bindsToAdsConversionId: spec.bindsToAdsConversionId ?? null,
          createdBy: 'gtm_conversion_setup_v1',
          source: process.env.GTM_API_MOCK === 'true' ? 'gtm_api_mock' : 'gtm_api',
        },
      });
    }

    if (spec.kind === 'trigger') {
      resourcePaths.set(spec.logicalKey, gtmTriggerIdFromPath(resourcePath) ?? resourcePath);
    } else {
      resourcePaths.set(spec.logicalKey, resourcePath);
    }
  }

  for (const spec of tagResources) {
    const existing = await findExistingGtmArtifact({ setupRunId, businessId, logicalKey: spec.logicalKey });

    let resourcePath;
    if (existing) {
      resourcePath = existing.externalId;
      reusedArtifacts += 1;
    } else {
      const firingTriggerIds = (spec.firingTriggerLogicalKeys ?? [])
        .map((key) => resourcePaths.get(key))
        .filter(Boolean);

      if (firingTriggerIds.length === 0) {
        throw new GtmProviderPreconditionError(
          `GTM tag ${spec.logicalKey} has no firing triggers available.`,
          'GTM_CREATE_FAILED'
        );
      }

      const tagPayload = {
        ...spec.gtmPayload,
        firingTriggerId: firingTriggerIds,
      };

      const created = await createGtmWorkspaceResource({
        gtmIds,
        accessToken,
        collection: 'tags',
        payload: tagPayload,
        logicalKey: spec.logicalKey,
      });
      resourcePath = created.resourcePath;
      tagsCreated += 1;

      await persistGtmArtifact({
        setupRunId,
        businessId,
        artifactType: spec.artifactType,
        logicalKey: spec.logicalKey,
        externalId: resourcePath,
        metadata: {
          role: 'conversion_tag',
          template: spec.template,
          templateVersion: plan.templateVersion,
          displayName: spec.displayName,
          bindsToAdsConversionId: spec.bindsToAdsConversionId ?? null,
          firingTriggerLogicalKeys: spec.firingTriggerLogicalKeys ?? [],
          firingTriggerIds,
          createdBy: 'gtm_conversion_setup_v1',
          source: process.env.GTM_API_MOCK === 'true' ? 'gtm_api_mock' : 'gtm_api',
        },
      });
    }

    resourcePaths.set(spec.logicalKey, resourcePath);
  }

  const versionLogicalKey = 'container_version';
  let publishedVersionPath;
  const existingVersion = await findExistingGtmArtifact({
    setupRunId,
    businessId,
    logicalKey: versionLogicalKey,
  });

  if (existingVersion) {
    publishedVersionPath = existingVersion.externalId;
    reusedArtifacts += 1;
  } else {
    const clickBuiltinTypes = requiredClickBuiltinTypes(plan);
    if (clickBuiltinTypes.length > 0) {
      await enableGtmBuiltinVariables(accessToken, gtmIds, clickBuiltinTypes);
    }

    const published = await createAndPublishContainerVersion({
      gtmIds,
      accessToken,
      setupRunId: setupRunId.toString(),
    });
    publishedVersionPath = published.publishedVersionPath;

    await persistGtmArtifact({
      setupRunId,
      businessId,
      artifactType: 'gtm_container',
      logicalKey: versionLogicalKey,
      externalId: publishedVersionPath,
      metadata: {
        role: 'container_version',
        templateVersion: plan.templateVersion,
        containerId: gtmIds.containerId,
        workspaceId: gtmIds.workspaceId,
        accountId: gtmIds.accountId,
        createdBy: 'gtm_conversion_setup_v1',
        source: process.env.GTM_API_MOCK === 'true' ? 'gtm_api_mock' : 'gtm_api',
      },
    });
  }

  const snapshotSource = process.env.GTM_API_MOCK === 'true' ? 'gtm_api_mock' : 'gtm_api';
  await ProviderSnapshot.findOneAndUpdate(
    {
      setupRunId,
      businessId,
      provider: 'gtm',
      snapshotType: 'gtm_container_version',
    },
    {
      $set: {
        payload: {
          source: snapshotSource,
          accountId: gtmIds.accountId,
          containerId: gtmIds.containerId,
          workspaceId: gtmIds.workspaceId,
          publicContainerId: gtmIds.publicContainerId,
          publishedVersionPath,
          templateVersion: plan.templateVersion,
          recordedAt: new Date().toISOString(),
        },
      },
      $setOnInsert: { immutable: false, snapshotVersion: 1 },
    },
    { upsert: true, setDefaultsOnInsert: true }
  );

  const summary = {
    templateVersion: plan.templateVersion,
    tagsCreated,
    triggersCreated,
    variablesCreated,
    reusedArtifacts,
    publishedVersion: publishedVersionPath,
    source: snapshotSource,
  };

  logger.info(
    {
      setupRunId: setupRunId.toString(),
      businessId: businessId.toString(),
      stepName: SETUP_STEP_NAMES.GTM_CONVERSION_SETUP,
      provider: 'gtm',
      ...summary,
    },
    'gtm conversion setup persisted artifacts'
  );

  return { summary, source: snapshotSource };
}

module.exports = {
  runGtmConversionSetup,
  GtmProviderPreconditionError,
  validateGtmIdentifiers,
  gtmTriggerIdFromPath,
  requiredClickBuiltinTypes,
};
