'use strict';

const mongoose = require('mongoose');
const { MIN_DAILY_BUDGET_MICROS } = require('../../constants/adsCampaignIntent');
const { createLogger } = require('../../lib/observability/logger');
const { resolveSetupUserErrorMessage } = require('../../lib/setupUserErrorMessages');
const {
  enableAdsCampaign,
  pauseAdsCampaign,
  updateCampaignBudget,
  getAdsCampaignLiveState,
  isCampaignBudgetResourceName,
} = require('../integrations/googleAdsCampaignClient');
const { GoogleAdsApiError } = require('../integrations/googleAdsApiConfig');
const {
  assertBusinessMembershipOrOwnership,
  MembershipCheckError,
} = require('../../lib/auth/membershipCheck');

const IntegrationArtifact = mongoose.model('IntegrationArtifact');
const BusinessContext = mongoose.model('BusinessContext');

const logger = createLogger({ name: 'adsCampaignManagementService' });

const DEFAULT_ADS_BUDGET_MAX_MICROS = 100_000_000;

/**
 * @returns {number}
 */
function getAdsBudgetMaxMicros() {
  const parsed = Number(process.env.ADS_BUDGET_MAX_MICROS);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return DEFAULT_ADS_BUDGET_MAX_MICROS;
}

class AdsCampaignManagementError extends Error {
  /**
   * @param {string} message
   * @param {string} [code]
   */
  constructor(message, code = 'ADS_CAMPAIGN_MANAGEMENT_ERROR') {
    super(message);
    this.name = 'AdsCampaignManagementError';
    this.code = code;
  }
}

/**
 * @param {string} userId
 * @param {import('mongoose').Types.ObjectId} businessId
 */
async function assertUserOwnsBusiness(userId, businessId) {
  try {
    await assertBusinessMembershipOrOwnership(userId, businessId.toString());
  } catch (err) {
    if (err instanceof MembershipCheckError) {
      throw new AdsCampaignManagementError(
        err.code === 'forbidden'
          ? err.message
          : 'Business context not found for this user',
        err.code === 'forbidden' ? 'ADS_CAMPAIGN_FORBIDDEN' : 'ADS_CAMPAIGN_BUSINESS_NOT_FOUND'
      );
    }
    throw err;
  }
}

/**
 * @param {import('mongoose').Types.ObjectId} businessId
 */
async function loadLatestCampaignArtifact(businessId) {
  return IntegrationArtifact.findOne({
    businessId,
    provider: 'google_ads',
    artifactType: 'ads_campaign',
  })
    .sort({ updatedAt: -1 })
    .lean();
}

/**
 * @param {import('mongoose').Types.ObjectId} businessId
 * @param {import('mongoose').Types.ObjectId} setupRunId
 */
async function loadBudgetArtifactForRun(businessId, setupRunId) {
  return IntegrationArtifact.findOne({
    businessId,
    setupRunId,
    provider: 'google_ads',
    artifactType: 'ads_campaign_budget',
  }).lean();
}

/**
 * @param {object} campaignArtifact
 * @param {import('mongoose').Types.ObjectId} businessId
 * @param {string} campaignResourceName
 */
async function resolveBudgetResourceName(businessId, campaignArtifact, campaignResourceName) {
  const fromMeta = campaignArtifact?.metadata?.budgetResourceName;
  if (isCampaignBudgetResourceName(fromMeta)) {
    return String(fromMeta).trim();
  }

  const budgetArtifact = await loadBudgetArtifactForRun(businessId, campaignArtifact.setupRunId);
  if (budgetArtifact && isCampaignBudgetResourceName(budgetArtifact.externalId)) {
    return String(budgetArtifact.externalId).trim();
  }

  const live = await getAdsCampaignLiveState({ businessId, campaignResourceName });
  if (isCampaignBudgetResourceName(live.budgetResourceName)) {
    return String(live.budgetResourceName).trim();
  }

  throw new AdsCampaignManagementError(
    'Campaign budget resource name could not be resolved.',
    'ADS_CAMPAIGN_BUDGET_NOT_FOUND'
  );
}

/**
 * @param {object} campaignArtifact
 * @param {Record<string, unknown>} action
 */
async function recordManagementAction(campaignArtifact, action) {
  const prior = Array.isArray(campaignArtifact.metadata?.managementActions)
    ? campaignArtifact.metadata.managementActions
    : [];
  const entry = {
    ...action,
    recordedAt: new Date().toISOString(),
  };
  const metadata = {
    ...(campaignArtifact.metadata ?? {}),
    managementActions: [...prior.slice(-49), entry],
  };
  await IntegrationArtifact.updateOne({ _id: campaignArtifact._id }, { $set: { metadata } });
  return entry;
}

/**
 * @param {unknown} err
 */
function mapManagementError(err) {
  if (err instanceof GoogleAdsApiError) {
    return {
      code: err.code,
      message: resolveSetupUserErrorMessage({
        errorCode: err.code,
        fallbackMessage: err.message,
      }),
    };
  }
  if (err instanceof AdsCampaignManagementError) {
    return {
      code: err.code,
      message: resolveSetupUserErrorMessage({
        errorCode: err.code,
        fallbackMessage: err.message,
      }),
    };
  }
  const message = err instanceof Error ? err.message : 'Campaign management failed.';
  return {
    code: 'ADS_CAMPAIGN_MANAGEMENT_ERROR',
    message: resolveSetupUserErrorMessage({ fallbackMessage: message }),
  };
}

/**
 * @param {string} userId
 * @param {string} businessIdRaw
 */
async function resolveCampaignContext(userId, businessIdRaw) {
  if (!businessIdRaw || !mongoose.Types.ObjectId.isValid(businessIdRaw)) {
    throw new AdsCampaignManagementError('businessId is required and must be valid.', 'validation_error');
  }
  const businessId = new mongoose.Types.ObjectId(businessIdRaw);
  await assertUserOwnsBusiness(userId, businessId);

  const campaignArtifact = await loadLatestCampaignArtifact(businessId);
  if (!campaignArtifact?.externalId) {
    throw new AdsCampaignManagementError(
      'No Google Ads campaign artifact was found for this business.',
      'ADS_CAMPAIGN_NOT_FOUND'
    );
  }

  const campaignResourceName = String(campaignArtifact.externalId).trim();
  return { businessId, campaignArtifact, campaignResourceName };
}

/**
 * @param {string} userId
 * @param {string} businessIdRaw
 */
async function getCampaignForBusiness(userId, businessIdRaw) {
  const { businessId, campaignArtifact, campaignResourceName } = await resolveCampaignContext(
    userId,
    businessIdRaw
  );
  const budgetResourceName = await resolveBudgetResourceName(
    businessId,
    campaignArtifact,
    campaignResourceName
  );
  const live = await getAdsCampaignLiveState({ businessId, campaignResourceName });

  return {
    campaignResourceName,
    status: live.status,
    budgetResourceName,
    amountMicros: live.amountMicros,
    setupRunId: campaignArtifact.setupRunId.toString(),
    source: live.source,
  };
}

/**
 * @param {string} userId
 * @param {string} businessIdRaw
 */
async function enableCampaignForBusiness(userId, businessIdRaw) {
  const { businessId, campaignArtifact, campaignResourceName } = await resolveCampaignContext(
    userId,
    businessIdRaw
  );

  const liveBefore = await getAdsCampaignLiveState({ businessId, campaignResourceName });
  if (liveBefore.status === 'ENABLED') {
    const entry = await recordManagementAction(campaignArtifact, {
      action: 'enable',
      outcome: 'no_op_already_enabled',
      statusBefore: liveBefore.status,
      statusAfter: liveBefore.status,
      source: liveBefore.source,
    });
    logger.info(
      { businessId: businessId.toString(), provider: 'google_ads', campaignResourceName },
      'ads campaign enable skipped — already enabled'
    );
    return { outcome: 'no_op_already_enabled', action: entry };
  }

  try {
    const result = await enableAdsCampaign({ businessId, campaignResourceName });
    const liveAfter = await getAdsCampaignLiveState({ businessId, campaignResourceName });
    const entry = await recordManagementAction(campaignArtifact, {
      action: 'enable',
      outcome: result.outcome,
      statusBefore: liveBefore.status,
      statusAfter: liveAfter.status,
      source: result.source,
    });
    logger.info(
      {
        businessId: businessId.toString(),
        provider: 'google_ads',
        campaignResourceName,
        outcome: result.outcome,
      },
      'ads campaign enabled'
    );
    return { outcome: result.outcome, status: liveAfter.status, action: entry };
  } catch (err) {
    const mapped = mapManagementError(err);
    await recordManagementAction(campaignArtifact, {
      action: 'enable',
      outcome: 'failed',
      statusBefore: liveBefore.status,
      errorCode: mapped.code,
      error: mapped.message,
    });
    logger.warn(
      {
        businessId: businessId.toString(),
        provider: 'google_ads',
        campaignResourceName,
        errorCode: mapped.code,
      },
      'ads campaign enable failed'
    );
    throw err;
  }
}

/**
 * @param {string} userId
 * @param {string} businessIdRaw
 */
async function pauseCampaignForBusiness(userId, businessIdRaw) {
  const { businessId, campaignArtifact, campaignResourceName } = await resolveCampaignContext(
    userId,
    businessIdRaw
  );

  const liveBefore = await getAdsCampaignLiveState({ businessId, campaignResourceName });
  if (liveBefore.status === 'PAUSED') {
    const entry = await recordManagementAction(campaignArtifact, {
      action: 'pause',
      outcome: 'no_op_already_paused',
      statusBefore: liveBefore.status,
      statusAfter: liveBefore.status,
      source: liveBefore.source,
    });
    logger.info(
      { businessId: businessId.toString(), provider: 'google_ads', campaignResourceName },
      'ads campaign pause skipped — already paused'
    );
    return { outcome: 'no_op_already_paused', action: entry };
  }

  try {
    const result = await pauseAdsCampaign({ businessId, campaignResourceName });
    const liveAfter = await getAdsCampaignLiveState({ businessId, campaignResourceName });
    const entry = await recordManagementAction(campaignArtifact, {
      action: 'pause',
      outcome: result.outcome,
      statusBefore: liveBefore.status,
      statusAfter: liveAfter.status,
      source: result.source,
    });
    logger.info(
      {
        businessId: businessId.toString(),
        provider: 'google_ads',
        campaignResourceName,
        outcome: result.outcome,
      },
      'ads campaign paused'
    );
    return { outcome: result.outcome, status: liveAfter.status, action: entry };
  } catch (err) {
    const mapped = mapManagementError(err);
    await recordManagementAction(campaignArtifact, {
      action: 'pause',
      outcome: 'failed',
      statusBefore: liveBefore.status,
      errorCode: mapped.code,
      error: mapped.message,
    });
    logger.warn(
      {
        businessId: businessId.toString(),
        provider: 'google_ads',
        campaignResourceName,
        errorCode: mapped.code,
      },
      'ads campaign pause failed'
    );
    throw err;
  }
}

/**
 * @param {string} userId
 * @param {string} businessIdRaw
 * @param {number} amountMicros
 */
async function updateBudgetForBusiness(userId, businessIdRaw, amountMicros) {
  const parsedAmount = Number(amountMicros);
  const maxMicros = getAdsBudgetMaxMicros();

  if (!Number.isFinite(parsedAmount) || parsedAmount < MIN_DAILY_BUDGET_MICROS) {
    throw new AdsCampaignManagementError(
      `Daily budget must be at least ${MIN_DAILY_BUDGET_MICROS} micros.`,
      'ADS_CAMPAIGN_BUDGET_TOO_LOW'
    );
  }
  if (parsedAmount > maxMicros) {
    throw new AdsCampaignManagementError(
      `Daily budget cannot exceed ${maxMicros} micros.`,
      'ADS_CAMPAIGN_BUDGET_MAX_EXCEEDED'
    );
  }

  const { businessId, campaignArtifact, campaignResourceName } = await resolveCampaignContext(
    userId,
    businessIdRaw
  );
  const budgetResourceName = await resolveBudgetResourceName(
    businessId,
    campaignArtifact,
    campaignResourceName
  );
  const liveBefore = await getAdsCampaignLiveState({ businessId, campaignResourceName });

  if (liveBefore.amountMicros === parsedAmount) {
    const entry = await recordManagementAction(campaignArtifact, {
      action: 'update_budget',
      outcome: 'no_op_same_amount',
      budgetResourceName,
      amountMicrosBefore: liveBefore.amountMicros,
      amountMicrosAfter: parsedAmount,
      source: liveBefore.source,
    });
    return { outcome: 'no_op_same_amount', amountMicros: parsedAmount, action: entry };
  }

  try {
    const result = await updateCampaignBudget({
      businessId,
      budgetResourceName,
      amountMicros: parsedAmount,
    });
    const liveAfter = await getAdsCampaignLiveState({ businessId, campaignResourceName });
    const entry = await recordManagementAction(campaignArtifact, {
      action: 'update_budget',
      outcome: result.outcome,
      budgetResourceName,
      amountMicrosBefore: liveBefore.amountMicros,
      amountMicrosAfter: liveAfter.amountMicros ?? parsedAmount,
      source: result.source,
    });
    logger.info(
      {
        businessId: businessId.toString(),
        provider: 'google_ads',
        budgetResourceName,
        amountMicros: parsedAmount,
        outcome: result.outcome,
      },
      'ads campaign budget updated'
    );
    return {
      outcome: result.outcome,
      amountMicros: liveAfter.amountMicros ?? parsedAmount,
      action: entry,
    };
  } catch (err) {
    const mapped = mapManagementError(err);
    await recordManagementAction(campaignArtifact, {
      action: 'update_budget',
      outcome: 'failed',
      budgetResourceName,
      amountMicrosBefore: liveBefore.amountMicros,
      amountMicrosRequested: parsedAmount,
      errorCode: mapped.code,
      error: mapped.message,
    });
    logger.warn(
      {
        businessId: businessId.toString(),
        provider: 'google_ads',
        budgetResourceName,
        errorCode: mapped.code,
      },
      'ads campaign budget update failed'
    );
    throw err;
  }
}

module.exports = {
  AdsCampaignManagementError,
  getAdsBudgetMaxMicros,
  mapManagementError,
  getCampaignForBusiness,
  enableCampaignForBusiness,
  pauseCampaignForBusiness,
  updateBudgetForBusiness,
};
