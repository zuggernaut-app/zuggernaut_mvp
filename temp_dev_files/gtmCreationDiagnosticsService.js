'use strict';

const mongoose = require('mongoose');
require('../../models');
const { getCreationDiagnosticSteps } = require('../../lib/dev/creationDiagnosticsMatrix');
const {
  normalizeCreationDiagnosticRunMode,
  buildCreationDiagnosticRunResult,
  buildCreationDiagnosticStepResult,
  buildSkippedCreationDiagnosticStepResult,
  buildDiagnosticResourceLabel,
} = require('../../lib/dev/creationDiagnosticResults');
const { runCreationDiagnosticStep } = require('../../lib/dev/creationDiagnosticsStepRunner');
const { assertCreationDiagnosticConnection } = require('../../lib/dev/assertCreationDiagnosticConnection');
const {
  createDiagnosticRunId,
  recordIntegrationDiagnosticArtifact,
} = require('./integrationDiagnosticArtifactService');
const { persistIntegrationDiagnosticRun } = require('./integrationDiagnosticRunService');
const {
  listGtmAccounts,
  listGtmContainers,
  createGtmContainer,
  resolveOrCreateWorkspace,
  createGtmWorkspaceResource,
  enableGtmBuiltinVariables,
  createGtmContainerVersion,
  publishGtmContainerVersion,
  getGtmAccessToken,
} = require('../integrations/googleTagManagerClient');

const BusinessContext = mongoose.model('BusinessContext');
const IntegrationConnection = mongoose.model('IntegrationConnection');

const BUILTIN_VARIABLE_TYPES = [
  'pageUrl',
  'clickId',
  'clickUrl',
  'clickText',
  'formId',
  'formUrl',
];

function buildGtmWorkspaceUrl(gtmIds) {
  return `https://tagmanager.google.com/#/container/accounts/${gtmIds.accountId}/containers/${gtmIds.containerId}/workspaces/${gtmIds.workspaceId}`;
}

/**
 * @param {object} ctx
 * @param {object} matrixStep
 * @param {object} created
 */
async function persistGtmDiagnosticArtifact(ctx, matrixStep, created) {
  await recordIntegrationDiagnosticArtifact(ctx.businessId, {
    provider: 'gtm',
    diagnosticRunId: ctx.diagnosticRunId,
    stepId: matrixStep.id,
    action: matrixStep.action,
    mode: ctx.mode,
    resourceType: matrixStep.resourceType,
    resourceId: created.resourceId,
    resourceName: created.resourceName,
    resourcePath: created.resourcePath,
    externalUrl: created.externalUrl,
    metadata: created.metadata,
  });
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {{ mode?: string }} [options]
 */
async function runGtmCreationDiagnostics(businessId, options = {}) {
  const mode = normalizeCreationDiagnosticRunMode('gtm', options.mode);
  const diagnosticRunId = createDiagnosticRunId();
  const startedAt = new Date().toISOString();
  const stepResultsById = new Map();

  const gate = await assertCreationDiagnosticConnection(businessId, 'gtm');
  if (!gate.ok) {
    const completedAt = new Date().toISOString();
    const runResult = buildCreationDiagnosticRunResult({
      diagnosticRunId,
      provider: 'gtm',
      mode,
      businessId: String(businessId),
      startedAt,
      completedAt,
      steps: [],
      ok: false,
      message: gate.message,
      errorCode: gate.errorCode,
    });
    await persistIntegrationDiagnosticRun(runResult);
    return runResult;
  }

  const bc = await BusinessContext.findOne({ businessId }).lean();
  const accessToken = await getGtmAccessToken({ businessId });
  const connection = await IntegrationConnection.findOne({ businessId, provider: 'gtm' })
    .select('providerIdentifiers')
    .lean();

  const ctx = {
    businessId,
    diagnosticRunId,
    mode,
    accessToken,
    gtmIds: {
      accountId: connection?.providerIdentifiers?.accountId ?? null,
      containerId: connection?.providerIdentifiers?.containerId ?? null,
      workspaceId: connection?.providerIdentifiers?.workspaceId ?? null,
      publicContainerId: connection?.providerIdentifiers?.publicContainerId ?? null,
    },
    resourcePaths: new Map(),
    measurementId:
      bc?.goals?.ga4MeasurementId ??
      bc?.audienceSignals?.ga4MeasurementId ??
      process.env.GTM_DIAGNOSTIC_GA4_MEASUREMENT_ID ??
      null,
    conversionId:
      bc?.goals?.googleAdsConversionId ?? process.env.GTM_DIAGNOSTIC_GOOGLE_ADS_CONVERSION_ID ?? null,
    conversionLabel:
      bc?.goals?.googleAdsConversionLabel ??
      process.env.GTM_DIAGNOSTIC_GOOGLE_ADS_CONVERSION_LABEL ??
      null,
    websiteUrl: bc?.websiteUrl ?? 'https://example.com',
  };

  const steps = [];
  let haltRequired = false;

  for (const matrixStep of getCreationDiagnosticSteps('gtm')) {
    if (haltRequired) {
      const skipped = buildSkippedCreationDiagnosticStepResult(matrixStep, {
        mode,
        message: 'Skipped because a prior required step failed.',
      });
      steps.push(skipped);
      stepResultsById.set(matrixStep.id, skipped);
      continue;
    }

    const result = await runCreationDiagnosticStep({
      matrixStep,
      mode,
      stepResultsById,
      execute: () => executeGtmDiagnosticStep(ctx, matrixStep),
    });

    steps.push(result);
    stepResultsById.set(matrixStep.id, result);

    if (!result.ok && !result.skipped && matrixStep.required) {
      haltRequired = true;
    }
  }

  const completedAt = new Date().toISOString();
  const runResult = buildCreationDiagnosticRunResult({
    diagnosticRunId,
    provider: 'gtm',
    mode,
    businessId: String(businessId),
    startedAt,
    completedAt,
    steps,
  });

  await persistIntegrationDiagnosticRun(runResult);
  return runResult;
}

/**
 * @param {object} ctx
 * @param {object} matrixStep
 */
async function executeGtmDiagnosticStep(ctx, matrixStep) {
  const resourceLabel = buildDiagnosticResourceLabel({
    businessId: ctx.businessId,
    stepId: matrixStep.id,
  });

  switch (matrixStep.action) {
    case 'ensure_container':
      return ensureGtmDiagnosticContainer(ctx, matrixStep, resourceLabel);
    case 'create_workspace':
      return createGtmDiagnosticWorkspace(ctx, matrixStep, resourceLabel);
    case 'enable_builtin_variables':
      return enableGtmDiagnosticBuiltinVariables(ctx, matrixStep);
    case 'create_data_layer_variable':
      return createGtmDiagnosticDataLayerVariable(ctx, matrixStep, resourceLabel);
    case 'create_page_view_trigger':
      return createGtmDiagnosticPageViewTrigger(ctx, matrixStep, resourceLabel);
    case 'create_custom_event_trigger':
      return createGtmDiagnosticCustomEventTrigger(ctx, matrixStep, resourceLabel);
    case 'create_ga4_config_tag':
      return createGtmDiagnosticGa4Tag(ctx, matrixStep, resourceLabel);
    case 'create_google_ads_conversion_tag':
      return createGtmDiagnosticAdsConversionTag(ctx, matrixStep, resourceLabel);
    case 'create_container_version':
      return createGtmDiagnosticContainerVersion(ctx, matrixStep, resourceLabel);
    case 'publish_container_version':
      return publishGtmDiagnosticContainerVersion(ctx, matrixStep);
    default:
      throw new Error(`Unsupported GTM diagnostic action: ${matrixStep.action}`);
  }
}

async function ensureGtmDiagnosticContainer(ctx, matrixStep, resourceLabel) {
  if (ctx.gtmIds.accountId && ctx.gtmIds.containerId) {
    const skipped = buildSkippedCreationDiagnosticStepResult(matrixStep, {
      mode: ctx.mode,
      message: matrixStep.skipWhen ?? 'Usable container already connected.',
      resourceId: ctx.gtmIds.containerId,
      resourceName: ctx.gtmIds.publicContainerId ?? ctx.gtmIds.containerId,
      resourcePath: `accounts/${ctx.gtmIds.accountId}/containers/${ctx.gtmIds.containerId}`,
    });
    return skipped;
  }

  const accounts = await listGtmAccounts(ctx.accessToken);
  const account = accounts.find((row) => row.accountId) ?? null;
  if (!account?.accountId) {
    return buildCreationDiagnosticStepResult({
      matrixStep,
      ok: false,
      skipped: false,
      message: 'No GTM account available. GTM accounts must be created manually in Google Tag Manager.',
      errorCode: 'GTM_ACCOUNT_REQUIRED',
    });
  }

  const containers = await listGtmContainers(ctx.accessToken, account.accountId);
  let container = containers.find((row) => row.containerId) ?? null;

  if (!container) {
    container = await createGtmContainer(ctx.accessToken, account.accountId, {
      name: resourceLabel,
      usageContext: ['web'],
    });
  }

  ctx.gtmIds.accountId = String(account.accountId);
  ctx.gtmIds.containerId = String(container.containerId);
  ctx.gtmIds.publicContainerId = container.publicContainerId ?? null;

  await IntegrationConnection.findOneAndUpdate(
    { businessId: ctx.businessId, provider: 'gtm' },
    {
      $set: {
        providerIdentifiers: {
          accountId: ctx.gtmIds.accountId,
          containerId: ctx.gtmIds.containerId,
          ...(ctx.gtmIds.publicContainerId ? { publicContainerId: ctx.gtmIds.publicContainerId } : {}),
          discoverySource: 'creation_diagnostics',
          discoveryRecordedAt: new Date().toISOString(),
        },
      },
    }
  );

  const created = {
    resourceId: ctx.gtmIds.containerId,
    resourceName: container.name ?? resourceLabel,
    resourcePath: `accounts/${ctx.gtmIds.accountId}/containers/${ctx.gtmIds.containerId}`,
    externalUrl: buildGtmWorkspaceUrl(ctx.gtmIds),
    metadata: { publicContainerId: ctx.gtmIds.publicContainerId },
  };
  await persistGtmDiagnosticArtifact(ctx, matrixStep, created);

  return buildCreationDiagnosticStepResult({
    matrixStep,
    ok: true,
    message: 'GTM container resolved or created.',
    resourceId: created.resourceId,
    resourceName: created.resourceName,
    details: created.metadata,
  });
}

async function createGtmDiagnosticWorkspace(ctx, matrixStep, resourceLabel) {
  const workspace = await resolveOrCreateWorkspace(
    ctx.accessToken,
    ctx.gtmIds.accountId,
    ctx.gtmIds.containerId,
    { workspaceName: resourceLabel }
  );

  ctx.gtmIds.workspaceId = String(workspace.workspaceId);

  await IntegrationConnection.findOneAndUpdate(
    { businessId: ctx.businessId, provider: 'gtm' },
    {
      $set: {
        'providerIdentifiers.workspaceId': ctx.gtmIds.workspaceId,
        'providerIdentifiers.discoveryRecordedAt': new Date().toISOString(),
      },
    }
  );

  const created = {
    resourceId: ctx.gtmIds.workspaceId,
    resourceName: workspace.name ?? resourceLabel,
    resourcePath: `accounts/${ctx.gtmIds.accountId}/containers/${ctx.gtmIds.containerId}/workspaces/${ctx.gtmIds.workspaceId}`,
    externalUrl: buildGtmWorkspaceUrl(ctx.gtmIds),
  };
  await persistGtmDiagnosticArtifact(ctx, matrixStep, created);

  return buildCreationDiagnosticStepResult({
    matrixStep,
    ok: true,
    message: 'GTM workspace resolved or created.',
    resourceId: created.resourceId,
    resourceName: created.resourceName,
  });
}

async function enableGtmDiagnosticBuiltinVariables(ctx, matrixStep) {
  const enabled = await enableGtmBuiltinVariables(ctx.accessToken, ctx.gtmIds, BUILTIN_VARIABLE_TYPES);
  const created = {
    resourceId: enabled.enabledTypes.join(','),
    resourceName: 'builtin_variables',
    resourcePath: `accounts/${ctx.gtmIds.accountId}/containers/${ctx.gtmIds.containerId}/workspaces/${ctx.gtmIds.workspaceId}/built_in_variables`,
    externalUrl: buildGtmWorkspaceUrl(ctx.gtmIds),
    metadata: { enabledTypes: enabled.enabledTypes },
  };
  await persistGtmDiagnosticArtifact(ctx, matrixStep, created);

  return buildCreationDiagnosticStepResult({
    matrixStep,
    ok: true,
    message: `Enabled ${enabled.enabledTypes.length} built-in variable type(s).`,
    resourceId: created.resourceId,
    details: created.metadata,
  });
}

async function createGtmDiagnosticDataLayerVariable(ctx, matrixStep, resourceLabel) {
  const createdResource = await createGtmWorkspaceResource({
    gtmIds: ctx.gtmIds,
    accessToken: ctx.accessToken,
    collection: 'variables',
    logicalKey: matrixStep.id,
    payload: {
      name: resourceLabel,
      type: 'v',
      parameter: [
        { type: 'integer', key: 'dataLayerVersion', value: '2' },
        { type: 'template', key: 'name', value: 'zug_conversion_value' },
      ],
    },
  });

  ctx.resourcePaths.set(matrixStep.id, createdResource.resourcePath);
  const created = {
    resourceId: createdResource.resourcePath,
    resourceName: resourceLabel,
    resourcePath: createdResource.resourcePath,
    externalUrl: buildGtmWorkspaceUrl(ctx.gtmIds),
  };
  await persistGtmDiagnosticArtifact(ctx, matrixStep, created);

  return buildCreationDiagnosticStepResult({
    matrixStep,
    ok: true,
    message: 'Data layer variable created.',
    resourceId: created.resourceId,
    resourceName: created.resourceName,
  });
}

async function createGtmDiagnosticPageViewTrigger(ctx, matrixStep, resourceLabel) {
  const createdResource = await createGtmWorkspaceResource({
    gtmIds: ctx.gtmIds,
    accessToken: ctx.accessToken,
    collection: 'triggers',
    logicalKey: matrixStep.id,
    payload: {
      name: resourceLabel,
      type: 'pageview',
    },
  });

  ctx.resourcePaths.set(matrixStep.id, createdResource.resourcePath);
  const created = {
    resourceId: createdResource.resourcePath,
    resourceName: resourceLabel,
    resourcePath: createdResource.resourcePath,
    externalUrl: buildGtmWorkspaceUrl(ctx.gtmIds),
  };
  await persistGtmDiagnosticArtifact(ctx, matrixStep, created);

  return buildCreationDiagnosticStepResult({
    matrixStep,
    ok: true,
    message: 'Page view trigger created.',
    resourceId: created.resourceId,
    resourceName: created.resourceName,
  });
}

async function createGtmDiagnosticCustomEventTrigger(ctx, matrixStep, resourceLabel) {
  const createdResource = await createGtmWorkspaceResource({
    gtmIds: ctx.gtmIds,
    accessToken: ctx.accessToken,
    collection: 'triggers',
    logicalKey: matrixStep.id,
    payload: {
      name: resourceLabel,
      type: 'customEvent',
      customEventFilter: [
        {
          type: 'equals',
          parameter: [
            { type: 'template', key: 'arg0', value: '{{_event}}' },
            { type: 'template', key: 'arg1', value: 'zuggernaut_conversion' },
          ],
        },
      ],
    },
  });

  ctx.resourcePaths.set(matrixStep.id, createdResource.resourcePath);
  const created = {
    resourceId: createdResource.resourcePath,
    resourceName: resourceLabel,
    resourcePath: createdResource.resourcePath,
    externalUrl: buildGtmWorkspaceUrl(ctx.gtmIds),
  };
  await persistGtmDiagnosticArtifact(ctx, matrixStep, created);

  return buildCreationDiagnosticStepResult({
    matrixStep,
    ok: true,
    message: 'Custom event trigger created.',
    resourceId: created.resourceId,
    resourceName: created.resourceName,
  });
}

async function createGtmDiagnosticGa4Tag(ctx, matrixStep, resourceLabel) {
  if (!ctx.measurementId) {
    return buildSkippedCreationDiagnosticStepResult(matrixStep, { mode: ctx.mode });
  }

  const firingTriggerId = ctx.resourcePaths.get('page_view_trigger');
  if (!firingTriggerId) {
    return buildCreationDiagnosticStepResult({
      matrixStep,
      ok: false,
      skipped: false,
      message: 'Page view trigger is required before creating the GA4 config tag.',
      errorCode: 'GTM_MISSING_PAGE_VIEW_TRIGGER',
    });
  }

  const createdResource = await createGtmWorkspaceResource({
    gtmIds: ctx.gtmIds,
    accessToken: ctx.accessToken,
    collection: 'tags',
    logicalKey: matrixStep.id,
    payload: {
      name: resourceLabel,
      type: 'googtag',
      parameter: [{ type: 'template', key: 'tagId', value: ctx.measurementId }],
      firingTriggerId: [firingTriggerId],
    },
  });

  const created = {
    resourceId: createdResource.resourcePath,
    resourceName: resourceLabel,
    resourcePath: createdResource.resourcePath,
    externalUrl: buildGtmWorkspaceUrl(ctx.gtmIds),
    metadata: { measurementId: ctx.measurementId },
  };
  await persistGtmDiagnosticArtifact(ctx, matrixStep, created);

  return buildCreationDiagnosticStepResult({
    matrixStep,
    ok: true,
    message: 'GA4 config tag created.',
    resourceId: created.resourceId,
    resourceName: created.resourceName,
    details: created.metadata,
  });
}

async function createGtmDiagnosticAdsConversionTag(ctx, matrixStep, resourceLabel) {
  if (!ctx.conversionId || !ctx.conversionLabel) {
    return buildSkippedCreationDiagnosticStepResult(matrixStep, { mode: ctx.mode });
  }

  const firingTriggerId = ctx.resourcePaths.get('custom_event_trigger');
  if (!firingTriggerId) {
    return buildCreationDiagnosticStepResult({
      matrixStep,
      ok: false,
      skipped: false,
      message: 'Custom event trigger is required before creating the Google Ads conversion tag.',
      errorCode: 'GTM_MISSING_CUSTOM_EVENT_TRIGGER',
    });
  }

  const createdResource = await createGtmWorkspaceResource({
    gtmIds: ctx.gtmIds,
    accessToken: ctx.accessToken,
    collection: 'tags',
    logicalKey: matrixStep.id,
    payload: {
      name: resourceLabel,
      type: 'awct',
      parameter: [
        { type: 'template', key: 'conversionId', value: String(ctx.conversionId) },
        { type: 'template', key: 'conversionLabel', value: String(ctx.conversionLabel) },
      ],
      firingTriggerId: [firingTriggerId],
    },
  });

  const created = {
    resourceId: createdResource.resourcePath,
    resourceName: resourceLabel,
    resourcePath: createdResource.resourcePath,
    externalUrl: buildGtmWorkspaceUrl(ctx.gtmIds),
    metadata: {
      conversionId: ctx.conversionId,
      conversionLabel: ctx.conversionLabel,
    },
  };
  await persistGtmDiagnosticArtifact(ctx, matrixStep, created);

  return buildCreationDiagnosticStepResult({
    matrixStep,
    ok: true,
    message: 'Google Ads conversion tag created.',
    resourceId: created.resourceId,
    resourceName: created.resourceName,
    details: created.metadata,
  });
}

async function createGtmDiagnosticContainerVersion(ctx, matrixStep, resourceLabel) {
  const createdVersion = await createGtmContainerVersion({
    gtmIds: ctx.gtmIds,
    accessToken: ctx.accessToken,
    versionName: resourceLabel,
  });

  ctx.containerVersionId = createdVersion.containerVersionId;

  const created = {
    resourceId: createdVersion.containerVersionId,
    resourceName: resourceLabel,
    resourcePath: createdVersion.versionPath,
    externalUrl: buildGtmWorkspaceUrl(ctx.gtmIds),
  };
  await persistGtmDiagnosticArtifact(ctx, matrixStep, created);

  return buildCreationDiagnosticStepResult({
    matrixStep,
    ok: true,
    message: 'Container version created.',
    resourceId: created.resourceId,
    resourceName: created.resourceName,
  });
}

async function publishGtmDiagnosticContainerVersion(ctx, matrixStep) {
  if (!ctx.containerVersionId) {
    return buildCreationDiagnosticStepResult({
      matrixStep,
      ok: false,
      skipped: false,
      message: 'Container version must be created before publish.',
      errorCode: 'GTM_MISSING_CONTAINER_VERSION',
    });
  }

  const published = await publishGtmContainerVersion({
    gtmIds: ctx.gtmIds,
    accessToken: ctx.accessToken,
    containerVersionId: ctx.containerVersionId,
  });

  const created = {
    resourceId: ctx.containerVersionId,
    resourceName: 'published_version',
    resourcePath: published.publishedVersionPath,
    externalUrl: buildGtmWorkspaceUrl(ctx.gtmIds),
  };
  await persistGtmDiagnosticArtifact(ctx, matrixStep, created);

  return buildCreationDiagnosticStepResult({
    matrixStep,
    ok: true,
    message: 'Container version published.',
    resourceId: created.resourceId,
    resourceName: created.resourceName,
  });
}

module.exports = {
  runGtmCreationDiagnostics,
};
