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
  normalizeCustomerId,
  createDiagnosticCampaignBudget,
  createDiagnosticSearchCampaign,
  attachDiagnosticLocationTargeting,
  attachDiagnosticLanguageTargeting,
  attachDiagnosticAdSchedule,
  createDiagnosticAdGroup,
  createDiagnosticResponsiveSearchAd,
  addDiagnosticKeyword,
  createDiagnosticConversionAction,
  createDiagnosticSitelinkAsset,
  createDiagnosticCalloutAsset,
  createDiagnosticCallAsset,
  createDiagnosticRemarketingUserList,
  createDiagnosticNegativeKeywordList,
  validateOfflineConversionImport,
} = require('../integrations/googleAdsCreationDiagnosticsClient');
const { getGoogleAdsLoginCustomerId } = require('../integrations/googleAdsApiConfig');

const BusinessContext = mongoose.model('BusinessContext');
const IntegrationConnection = mongoose.model('IntegrationConnection');

function buildGoogleAdsExternalUrl(customerId) {
  return `https://ads.google.com/aw/overview?ocid=${customerId}`;
}

/**
 * @param {object} ctx
 * @param {object} matrixStep
 * @param {object} created
 */
async function persistAdsDiagnosticArtifact(ctx, matrixStep, created) {
  await recordIntegrationDiagnosticArtifact(ctx.businessId, {
    provider: 'google_ads',
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
async function runGoogleAdsCreationDiagnostics(businessId, options = {}) {
  const mode = normalizeCreationDiagnosticRunMode('google_ads', options.mode);
  const diagnosticRunId = createDiagnosticRunId();
  const startedAt = new Date().toISOString();
  const stepResultsById = new Map();

  const gate = await assertCreationDiagnosticConnection(businessId, 'google_ads');
  if (!gate.ok) {
    const completedAt = new Date().toISOString();
    const runResult = buildCreationDiagnosticRunResult({
      diagnosticRunId,
      provider: 'google_ads',
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
  const connection = await IntegrationConnection.findOne({ businessId, provider: 'google_ads' })
    .select('providerIdentifiers')
    .lean();

  const customerId = normalizeCustomerId(connection?.providerIdentifiers?.customerId ?? null);
  const loginCustomerId =
    normalizeCustomerId(connection?.providerIdentifiers?.loginCustomerId) ??
    normalizeCustomerId(connection?.providerIdentifiers?.managerCustomerId) ??
    getGoogleAdsLoginCustomerId();

  if (!customerId) {
    const completedAt = new Date().toISOString();
    const runResult = buildCreationDiagnosticRunResult({
      diagnosticRunId,
      provider: 'google_ads',
      mode,
      businessId: String(businessId),
      startedAt,
      completedAt,
      steps: [],
      ok: false,
      message: 'No Google Ads customer ID is available for creation diagnostics.',
      errorCode: 'ADS_CUSTOMER_REQUIRED',
    });
    await persistIntegrationDiagnosticRun(runResult);
    return runResult;
  }

  const phoneNumber =
    bc?.contactMethods?.phone ??
    bc?.contactMethods?.primaryPhone ??
    bc?.audienceSignals?.phone ??
    null;

  const ctx = {
    businessId,
    diagnosticRunId,
    mode,
    customerId,
    loginCustomerId,
    websiteUrl: bc?.websiteUrl ?? 'https://example.com',
    phoneNumber,
    resources: {},
  };

  const steps = [];
  let haltRequired = false;

  for (const matrixStep of getCreationDiagnosticSteps('google_ads')) {
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
      execute: () => executeGoogleAdsDiagnosticStep(ctx, matrixStep),
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
    provider: 'google_ads',
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
async function executeGoogleAdsDiagnosticStep(ctx, matrixStep) {
  const resourceLabel = buildDiagnosticResourceLabel({
    businessId: ctx.businessId,
    stepId: matrixStep.id,
  });
  const mutateCtx = {
    businessId: ctx.businessId,
    customerId: ctx.customerId,
    resourceLabel,
  };

  switch (matrixStep.action) {
    case 'create_campaign_budget': {
      const created = await createDiagnosticCampaignBudget(mutateCtx);
      ctx.resources.budgetResourceName = created.resourceName;
      return persistAndBuildStep(ctx, matrixStep, created, resourceLabel, 'Campaign budget created.');
    }
    case 'create_search_campaign': {
      const created = await createDiagnosticSearchCampaign({
        ...mutateCtx,
        budgetResourceName: ctx.resources.budgetResourceName,
      });
      ctx.resources.campaignResourceName = created.resourceName;
      return persistAndBuildStep(ctx, matrixStep, created, resourceLabel, 'Paused search campaign created.');
    }
    case 'attach_location_targeting': {
      const created = await attachDiagnosticLocationTargeting({
        ...mutateCtx,
        campaignResourceName: ctx.resources.campaignResourceName,
      });
      return persistAndBuildStep(ctx, matrixStep, created, resourceLabel, 'Location targeting attached.');
    }
    case 'attach_language_targeting': {
      const created = await attachDiagnosticLanguageTargeting({
        ...mutateCtx,
        campaignResourceName: ctx.resources.campaignResourceName,
      });
      return persistAndBuildStep(ctx, matrixStep, created, resourceLabel, 'Language targeting attached.');
    }
    case 'attach_ad_schedule': {
      const created = await attachDiagnosticAdSchedule({
        ...mutateCtx,
        campaignResourceName: ctx.resources.campaignResourceName,
      });
      return persistAndBuildStep(ctx, matrixStep, created, resourceLabel, 'Ad schedule attached.');
    }
    case 'create_ad_group': {
      const created = await createDiagnosticAdGroup({
        ...mutateCtx,
        campaignResourceName: ctx.resources.campaignResourceName,
      });
      ctx.resources.adGroupResourceName = created.resourceName;
      return persistAndBuildStep(ctx, matrixStep, created, resourceLabel, 'Paused ad group created.');
    }
    case 'create_responsive_search_ad': {
      const created = await createDiagnosticResponsiveSearchAd({
        ...mutateCtx,
        adGroupResourceName: ctx.resources.adGroupResourceName,
        finalUrl: ctx.websiteUrl,
      });
      return persistAndBuildStep(ctx, matrixStep, created, resourceLabel, 'Paused responsive search ad created.');
    }
    case 'add_keyword_broad': {
      const created = await addDiagnosticKeyword({
        ...mutateCtx,
        adGroupResourceName: ctx.resources.adGroupResourceName,
        keywordText: 'zuggernaut dev test broad',
        matchType: 'BROAD',
      });
      return persistAndBuildStep(ctx, matrixStep, created, resourceLabel, 'Broad match keyword added.');
    }
    case 'add_keyword_phrase': {
      const created = await addDiagnosticKeyword({
        ...mutateCtx,
        adGroupResourceName: ctx.resources.adGroupResourceName,
        keywordText: 'zuggernaut dev test phrase',
        matchType: 'PHRASE',
      });
      return persistAndBuildStep(ctx, matrixStep, created, resourceLabel, 'Phrase match keyword added.');
    }
    case 'add_keyword_exact': {
      const created = await addDiagnosticKeyword({
        ...mutateCtx,
        adGroupResourceName: ctx.resources.adGroupResourceName,
        keywordText: 'zuggernaut dev test exact',
        matchType: 'EXACT',
      });
      return persistAndBuildStep(ctx, matrixStep, created, resourceLabel, 'Exact match keyword added.');
    }
    case 'create_conversion_action': {
      const created = await createDiagnosticConversionAction(mutateCtx);
      ctx.resources.conversionActionResourceName = created.resourceName;
      return persistAndBuildStep(ctx, matrixStep, created, resourceLabel, 'Conversion action created.');
    }
    case 'create_sitelink_asset': {
      const created = await createDiagnosticSitelinkAsset({
        ...mutateCtx,
        campaignResourceName: ctx.resources.campaignResourceName,
      });
      return persistAndBuildStep(ctx, matrixStep, created, resourceLabel, 'Sitelink asset created and linked.');
    }
    case 'create_callout_asset': {
      const created = await createDiagnosticCalloutAsset({
        ...mutateCtx,
        campaignResourceName: ctx.resources.campaignResourceName,
      });
      return persistAndBuildStep(ctx, matrixStep, created, resourceLabel, 'Callout asset created and linked.');
    }
    case 'create_call_asset': {
      if (!ctx.phoneNumber) {
        return buildSkippedCreationDiagnosticStepResult(matrixStep, { mode: ctx.mode });
      }
      const created = await createDiagnosticCallAsset({
        ...mutateCtx,
        campaignResourceName: ctx.resources.campaignResourceName,
        phoneNumber: String(ctx.phoneNumber),
      });
      return persistAndBuildStep(ctx, matrixStep, created, resourceLabel, 'Call asset created and linked.');
    }
    case 'create_remarketing_user_list': {
      try {
        const created = await createDiagnosticRemarketingUserList(mutateCtx);
        return persistAndBuildStep(ctx, matrixStep, created, resourceLabel, 'Remarketing user list created.');
      } catch (err) {
        return buildSkippedCreationDiagnosticStepResult(matrixStep, {
          mode: ctx.mode,
          message: matrixStep.skipWhen ?? 'Account does not support remarketing user lists.',
          details: { underlyingError: err instanceof Error ? err.message : String(err) },
        });
      }
    }
    case 'create_negative_keyword_list': {
      const created = await createDiagnosticNegativeKeywordList(mutateCtx);
      return persistAndBuildStep(ctx, matrixStep, created, resourceLabel, 'Negative keyword list created.');
    }
    case 'validate_offline_conversion_import': {
      const validation = await validateOfflineConversionImport(mutateCtx);
      const created = {
        resourceId: `offline-import-validation-${ctx.diagnosticRunId}`,
        resourceName: resourceLabel,
        resourcePath: `customers/${ctx.customerId}/offlineConversionUploads:validateOnly`,
        externalUrl: buildGoogleAdsExternalUrl(ctx.customerId),
        metadata: validation,
      };
      await persistAdsDiagnosticArtifact(ctx, matrixStep, created);
      return buildCreationDiagnosticStepResult({
        matrixStep,
        ok: true,
        message: validation.message,
        resourceId: created.resourceId,
        resourceName: created.resourceName,
        details: validation,
      });
    }
    default:
      throw new Error(`Unsupported Google Ads diagnostic action: ${matrixStep.action}`);
  }
}

/**
 * @param {object} ctx
 * @param {object} matrixStep
 * @param {{ resourceName: string }} created
 * @param {string} resourceLabel
 * @param {string} message
 */
async function persistAndBuildStep(ctx, matrixStep, created, resourceLabel, message) {
  const artifact = {
    resourceId: created.resourceName,
    resourceName: resourceLabel,
    resourcePath: created.resourceName,
    externalUrl: buildGoogleAdsExternalUrl(ctx.customerId),
    metadata: { source: created.source ?? null },
  };
  await persistAdsDiagnosticArtifact(ctx, matrixStep, artifact);

  return buildCreationDiagnosticStepResult({
    matrixStep,
    ok: true,
    message,
    resourceId: artifact.resourceId,
    resourceName: artifact.resourceName,
    details: artifact.metadata,
  });
}

module.exports = {
  runGoogleAdsCreationDiagnostics,
};
