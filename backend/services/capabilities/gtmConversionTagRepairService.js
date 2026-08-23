'use strict';

const mongoose = require('mongoose');
const { buildGtmSetupPlan } = require('./gtmTemplates/v1');
const { requireSetupReadyConnection } = require('./setupReadyConnectionService');
const {
  createGtmWorkspace,
  createGtmWorkspaceResource,
  listGtmWorkspaceResources,
  updateGtmWorkspaceResource,
  createGtmContainerVersion,
  publishGtmContainerVersion,
  enableGtmBuiltinVariables,
  getGtmAccessToken,
  fetchGtmLiveContainerVersionPath,
} = require('../integrations/googleTagManagerClient');

const IntegrationArtifact = mongoose.model('IntegrationArtifact');
const IntegrationConnection = mongoose.model('IntegrationConnection');
const BusinessContext = mongoose.model('BusinessContext');

const REPAIR_STEP = 'gtm_conversion_tag_repair';
const CONVERSION_TAG_TEMPLATES = ['ads_conversion_form', 'ads_conversion_call'];

class GtmConversionTagRepairError extends Error {
  constructor(message, code = 'GTM_CONVERSION_TAG_REPAIR_FAILED') {
    super(message);
    this.name = 'GtmConversionTagRepairError';
    this.code = code;
  }
}

/**
 * @param {string | null | undefined} resourcePath
 * @returns {string | null}
 */
function gtmTriggerIdFromPath(resourcePath) {
  if (!resourcePath || typeof resourcePath !== 'string') return null;
  const match = resourcePath.match(/\/triggers\/(\d+)$/);
  return match ? match[1] : null;
}

function requiredClickBuiltinTypes() {
  return ['clickUrl', 'clickText', 'clickElement'];
}

/**
 * @param {object | null | undefined} resource
 * @returns {string | null}
 */
function constantVariableValue(resource) {
  if (!resource || resource.type !== 'c' || !Array.isArray(resource.parameter)) return null;
  const valueParam = resource.parameter.find((p) => p && p.key === 'value');
  return valueParam?.value != null ? String(valueParam.value) : null;
}

/**
 * @param {object | null | undefined} resource
 * @param {string} key
 */
function awctParameterValue(resource, key) {
  if (!Array.isArray(resource?.parameter)) return null;
  const param = resource.parameter.find((p) => p?.key === key);
  return param?.value != null ? String(param.value) : null;
}

/**
 * @param {object} existing
 * @param {object} intendedPayload
 */
function constantVariableMatches(existing, intendedPayload) {
  return constantVariableValue(existing) === constantVariableValue(intendedPayload);
}

/**
 * @param {object} existing
 * @param {object} intendedPayload
 */
function awctParametersMatch(existing, intendedPayload) {
  return (
    awctParameterValue(existing, 'conversionId') ===
      awctParameterValue(intendedPayload, 'conversionId') &&
    awctParameterValue(existing, 'conversionLabel') ===
      awctParameterValue(intendedPayload, 'conversionLabel')
  );
}

/**
 * @param {object[]} items
 * @param {string} name
 */
function findWorkspaceResourceByName(items, name) {
  return items.find((item) => item?.name === name) ?? null;
}

/**
 * @param {object[]} affectedArtifacts
 * @returns {string[]}
 */
function collectRepairBusinessIds(affectedArtifacts) {
  const ids = new Set();
  for (const row of affectedArtifacts) {
    if (row?.businessId) ids.add(String(row.businessId));
  }
  return [...ids];
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function loadConversionArtifactsForRepair(businessId) {
  const latest = await IntegrationArtifact.findOne({
    businessId,
    provider: 'google_ads',
    artifactType: 'ads_conversion_action',
  })
    .sort({ createdAt: -1 })
    .select('setupRunId')
    .lean();

  if (!latest?.setupRunId) {
    throw new GtmConversionTagRepairError(
      'No Ads conversion artifacts found for GTM conversion tag repair.',
      'GTM_REPAIR_MISSING_CONVERSIONS'
    );
  }

  return IntegrationArtifact.find({
    businessId,
    setupRunId: latest.setupRunId,
    provider: 'google_ads',
    artifactType: 'ads_conversion_action',
  }).lean();
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {object} plan
 */
async function rewriteGtmTagArtifactParameters(businessId, plan) {
  const tagSpecs = plan.resources.filter((resource) => resource.kind === 'tag');
  for (const spec of tagSpecs) {
    if (!spec.template || !CONVERSION_TAG_TEMPLATES.includes(spec.template)) continue;
    await IntegrationArtifact.updateMany(
      {
        businessId,
        provider: 'gtm',
        artifactType: 'gtm_tag',
        'metadata.template': spec.template,
      },
      {
        $set: {
          'metadata.gtmPayload.parameter': spec.gtmPayload.parameter,
        },
      }
    );
  }
}

/**
 * @param {object} ctx
 * @param {string} ctx.accessToken
 * @param {object} ctx.gtmIds
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 */
async function createRepairWorkspace(ctx) {
  const { accessToken, gtmIds, businessId } = ctx;
  const workspaceName = `Zuggernaut repair ${String(businessId).slice(-8)}`;
  const workspace = await createGtmWorkspace(
    accessToken,
    gtmIds.accountId,
    gtmIds.containerId,
    workspaceName
  );

  await IntegrationConnection.findOneAndUpdate(
    { businessId, provider: 'gtm' },
    { $set: { 'providerIdentifiers.workspaceId': workspace.workspaceId } }
  );

  return {
    ...gtmIds,
    workspaceId: workspace.workspaceId,
  };
}

/**
 * @param {object} ctx
 * @param {object} ctx.plan
 * @param {string} ctx.accessToken
 * @param {object} ctx.gtmIds
 */
async function repairGtmSetupPlanInWorkspace(ctx) {
  const { plan, accessToken, gtmIds } = ctx;
  const nonTagResources = plan.resources.filter((resource) => resource.kind !== 'tag');
  const tagResources = plan.resources.filter((resource) => resource.kind === 'tag');
  const resourcePaths = new Map();

  const [workspaceVariables, workspaceTriggers, workspaceTags] = await Promise.all([
    listGtmWorkspaceResources(accessToken, gtmIds, 'variables'),
    listGtmWorkspaceResources(accessToken, gtmIds, 'triggers'),
    listGtmWorkspaceResources(accessToken, gtmIds, 'tags'),
  ]);

  for (const spec of nonTagResources) {
    const collection = spec.kind === 'variable' ? 'variables' : 'triggers';
    const workspaceItems = collection === 'variables' ? workspaceVariables : workspaceTriggers;
    const existing = findWorkspaceResourceByName(workspaceItems, spec.gtmPayload.name);

    let resourcePath;
    if (existing?.path) {
      if (
        collection === 'variables' &&
        spec.gtmPayload.type === 'c' &&
        !constantVariableMatches(existing, spec.gtmPayload)
      ) {
        const updated = await updateGtmWorkspaceResource({
          accessToken,
          collection,
          existing,
          payload: spec.gtmPayload,
        });
        resourcePath = updated.resourcePath;
      } else {
        resourcePath = existing.path;
      }
    } else {
      const created = await createGtmWorkspaceResource({
        gtmIds,
        accessToken,
        collection,
        payload: spec.gtmPayload,
        logicalKey: spec.logicalKey,
      });
      resourcePath = created.resourcePath;
    }

    if (spec.kind === 'trigger') {
      resourcePaths.set(
        spec.logicalKey,
        gtmTriggerIdFromPath(resourcePath) ?? resourcePath
      );
    } else {
      resourcePaths.set(spec.logicalKey, resourcePath);
    }
  }

  for (const spec of tagResources) {
    const firingTriggerIds = (spec.firingTriggerLogicalKeys ?? [])
      .map((key) => resourcePaths.get(key))
      .filter(Boolean);

    if (firingTriggerIds.length === 0) {
      throw new GtmConversionTagRepairError(
        `GTM tag ${spec.logicalKey} has no firing triggers available for repair.`,
        'GTM_REPAIR_CREATE_FAILED'
      );
    }

    const tagPayload = {
      ...spec.gtmPayload,
      firingTriggerId: firingTriggerIds,
    };
    const existing = findWorkspaceResourceByName(workspaceTags, spec.gtmPayload.name);

    if (existing?.path) {
      if (!awctParametersMatch(existing, tagPayload)) {
        await updateGtmWorkspaceResource({
          accessToken,
          collection: 'tags',
          existing,
          payload: tagPayload,
        });
      }
      continue;
    }

    await createGtmWorkspaceResource({
      gtmIds,
      accessToken,
      collection: 'tags',
      payload: tagPayload,
      logicalKey: spec.logicalKey,
    });
  }
}

/**
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId | string} ctx.businessId
 * @param {import('pino').Logger} [ctx.logger]
 */
async function repairGtmConversionTagsForBusiness(ctx) {
  const { businessId, logger } = ctx;

  if (process.env.GTM_API_MOCK !== 'true' && process.env.GTM_API_ENABLED !== 'true') {
    throw new GtmConversionTagRepairError(
      'GTM API is not enabled on this deployment (set GTM_API_ENABLED=true after wiring credentials).',
      'GTM_API_NOT_ENABLED'
    );
  }

  const conversionArtifacts = await loadConversionArtifactsForRepair(businessId);
  const { gtmIds } = await requireSetupReadyConnection(
    businessId,
    'gtm',
    GtmConversionTagRepairError
  );
  const { customerId: adsCustomerId } = await requireSetupReadyConnection(
    businessId,
    'google_ads',
    GtmConversionTagRepairError
  );

  const bc = await BusinessContext.findOne({ businessId }).lean();
  const plan = buildGtmSetupPlan({
    conversionArtifacts,
    adsCustomerId,
    websiteUrl: bc?.websiteUrl ?? null,
    thankYouUrls: Array.isArray(bc?.thankYouUrls) ? bc.thankYouUrls : [],
    nameKey: bc?.nameKey ?? null,
  });

  const accessToken = await getGtmAccessToken({ businessId });
  const rollback = await fetchGtmLiveContainerVersionPath(
    accessToken,
    gtmIds.accountId,
    gtmIds.containerId
  );
  const activeGtmIds = await createRepairWorkspace({ accessToken, gtmIds, businessId });

  await repairGtmSetupPlanInWorkspace({
    plan,
    accessToken,
    gtmIds: activeGtmIds,
  });

  const clickBuiltinTypes = requiredClickBuiltinTypes();
  if (clickBuiltinTypes.length > 0) {
    await enableGtmBuiltinVariables(accessToken, activeGtmIds, clickBuiltinTypes);
  }

  const created = await createGtmContainerVersion({
    gtmIds: activeGtmIds,
    accessToken,
    versionName: `Zuggernaut conversion tag repair ${String(businessId).slice(-8)}`,
  });
  const published = await publishGtmContainerVersion({
    gtmIds: activeGtmIds,
    accessToken,
    containerVersionId: created.containerVersionId,
  });

  await rewriteGtmTagArtifactParameters(businessId, plan);

  const result = {
    businessId: String(businessId),
    rollbackVersionPath: rollback.path,
    publishedVersionPath: published.publishedVersionPath,
    workspaceId: activeGtmIds.workspaceId,
  };

  logger?.info?.(
    {
      businessId: String(businessId),
      stepName: REPAIR_STEP,
      provider: 'gtm',
      ...result,
    },
    'gtm conversion tag repair published'
  );

  return result;
}

/**
 * @param {object} ctx
 * @param {object[]} ctx.affectedArtifacts
 * @param {import('pino').Logger} [ctx.logger]
 */
async function repairAffectedGtmConversionTags(ctx) {
  const { affectedArtifacts, logger } = ctx;
  const businessIds = collectRepairBusinessIds(affectedArtifacts);
  const results = [];
  const errors = [];

  for (const businessId of businessIds) {
    try {
      results.push(await repairGtmConversionTagsForBusiness({ businessId, logger }));
    } catch (err) {
      errors.push({
        businessId,
        message: err instanceof Error ? err.message : String(err),
        code: err?.code ?? null,
      });
    }
  }

  return { results, errors };
}

module.exports = {
  GtmConversionTagRepairError,
  collectRepairBusinessIds,
  awctParametersMatch,
  constantVariableMatches,
  repairGtmConversionTagsForBusiness,
  repairAffectedGtmConversionTags,
};
