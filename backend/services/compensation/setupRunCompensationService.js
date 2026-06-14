'use strict';

/**
 * V1 compensation: pause partial Ads campaigns; record GTM manual-review guidance.
 * Automated GTM container rollback is intentionally deferred — Tag Manager delete/revert
 * APIs are destructive and account-specific; operators resolve via GTM UI before retry.
 */

const mongoose = require('mongoose');
const { SETUP_STEP_NAMES } = require('../../constants/setupWorkflow');
const { pauseAdsCampaign } = require('../integrations/googleAdsCampaignClient');
const SetupRun = mongoose.model('SetupRun');
const IntegrationArtifact = mongoose.model('IntegrationArtifact');

/**
 * @param {object | null | undefined} meta
 */
function existingCompensation(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const compensation = meta.compensation;
  if (!compensation || typeof compensation !== 'object') return null;
  if (typeof compensation.appliedAt !== 'string') return null;
  return compensation;
}

/**
 * Idempotent compensation for partial setup failures.
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId} ctx.setupRunId
 * @param {import('mongoose').Types.ObjectId} ctx.businessId
 * @param {string} ctx.failedStep
 * @param {import('pino').Logger} ctx.logger
 */
async function runSetupRunCompensation(ctx) {
  const { setupRunId, businessId, failedStep, logger } = ctx;

  const setupRun = await SetupRun.findById(setupRunId).lean();
  const prior = existingCompensation(setupRun?.meta);
  if (prior) {
    logger.info(
      {
        setupRunId: setupRunId.toString(),
        businessId: businessId.toString(),
        failedStep,
        compensationIdempotent: true,
      },
      'setup compensation skipped (already applied)'
    );
    return prior;
  }

  /** @type {Array<Record<string, unknown>>} */
  const actions = [];

  if (failedStep === SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION) {
    const campaignArtifact = await IntegrationArtifact.findOne({
      setupRunId,
      businessId,
      provider: 'google_ads',
      artifactType: 'ads_campaign',
    }).lean();

    if (campaignArtifact?.externalId) {
      try {
        const paused = await pauseAdsCampaign({
          businessId,
          campaignResourceName: campaignArtifact.externalId,
        });
        actions.push({
          type: 'ads_campaign_pause',
          campaignResourceName: campaignArtifact.externalId,
          outcome: paused.outcome,
          source: paused.source,
        });
        logger.info(
          {
            setupRunId: setupRunId.toString(),
            businessId: businessId.toString(),
            campaignResourceName: campaignArtifact.externalId,
            outcome: paused.outcome,
          },
          'compensation paused ads campaign'
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Ads campaign pause failed';
        actions.push({
          type: 'ads_campaign_pause',
          campaignResourceName: campaignArtifact.externalId,
          outcome: 'failed',
          error: msg,
        });
        logger.warn(
          {
            setupRunId: setupRunId.toString(),
            businessId: businessId.toString(),
            campaignResourceName: campaignArtifact.externalId,
            error: msg,
          },
          'compensation ads campaign pause failed'
        );
      }
    }
  }

  if (failedStep === SETUP_STEP_NAMES.GTM_CONVERSION_SETUP) {
    const gtmArtifactCount = await IntegrationArtifact.countDocuments({
      setupRunId,
      businessId,
      provider: 'gtm',
    });

    if (gtmArtifactCount > 0) {
      actions.push({
        type: 'gtm_manual_review_guidance',
        outcome: 'recorded',
        artifactCount: gtmArtifactCount,
        message:
          'GTM artifacts may exist in your container. Review published changes in Google Tag Manager before retrying setup. Zuggernaut does not auto-delete GTM resources.',
      });
      logger.info(
        {
          setupRunId: setupRunId.toString(),
          businessId: businessId.toString(),
          gtmArtifactCount,
        },
        'compensation recorded gtm manual review guidance'
      );
    }
  }

  if (failedStep === SETUP_STEP_NAMES.PROVISION_GTM_RESOURCES) {
    actions.push({
      type: 'gtm_provisioning_failure_guidance',
      outcome: 'recorded',
      message:
        'GTM provisioning failed after approval. If no GTM account exists, create one at https://tagmanager.google.com first. Otherwise review permissions and approve provisioning again before starting a new setup run.',
    });
    logger.info(
      {
        setupRunId: setupRunId.toString(),
        businessId: businessId.toString(),
      },
      'compensation recorded gtm provisioning failure guidance'
    );
  }

  if (failedStep === SETUP_STEP_NAMES.PROVISION_GOOGLE_ADS_CUSTOMER) {
    actions.push({
      type: 'ads_provisioning_failure_guidance',
      outcome: 'recorded',
      message:
        'Google Ads customer provisioning failed after approval. Confirm MCC configuration and billing eligibility, then approve provisioning again before starting a new setup run.',
    });
    logger.info(
      {
        setupRunId: setupRunId.toString(),
        businessId: businessId.toString(),
      },
      'compensation recorded ads provisioning failure guidance'
    );
  }

  const result = {
    appliedAt: new Date().toISOString(),
    failedStep,
    actions,
  };

  await SetupRun.updateOne({ _id: setupRunId }, { $set: { 'meta.compensation': result } });
  return result;
}

module.exports = {
  runSetupRunCompensation,
  existingCompensation,
};
