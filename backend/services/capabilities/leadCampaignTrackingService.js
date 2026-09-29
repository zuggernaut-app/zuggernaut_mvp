'use strict';

const mongoose = require('mongoose');
const { SETUP_STEP_NAMES } = require('../../constants/setupWorkflow');
const { LEAD_CAMPAIGN_SLOTS } = require('../../constants/leadCampaign');
const { getLeadCampaignSet, updateSlot } = require('./leadCampaignSetService');

const BusinessContext = mongoose.model('BusinessContext');
const IntegrationArtifact = mongoose.model('IntegrationArtifact');
const SetupStepExecution = mongoose.model('SetupStepExecution');

const MIN_CALL_CONVERSION_DURATION_SECONDS = 60;
const COMPLETED_VERIFICATION_STATUSES = ['success', 'failed', 'skipped'];

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function resolveFormTrackingStatus(businessId) {
  const step = await SetupStepExecution.findOne({
    businessId,
    stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
    status: { $in: COMPLETED_VERIFICATION_STATUSES },
  })
    .sort({ endedAt: -1, updatedAt: -1 })
    .lean();

  if (!step) {
    return { status: 'not_checked', checkedAt: null };
  }

  const checkedAt =
    step.endedAt?.toISOString() ?? step.updatedAt?.toISOString() ?? null;

  if (step.status === 'success') {
    return { status: 'passed', checkedAt };
  }

  return { status: 'failed', checkedAt };
}

/**
 * @param {object | null | undefined} metadata
 */
function isCallDurationSatisfied(metadata) {
  const duration =
    metadata?.phoneCallDurationSeconds ?? metadata?.callDurationSeconds ?? null;
  return duration != null && duration >= MIN_CALL_CONVERSION_DURATION_SECONDS;
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {'recommended' | 'alternative'} slot
 */
async function resolveCallTrackingStatus(businessId, slot) {
  const callAsset = await IntegrationArtifact.findOne({
    businessId,
    provider: 'google_ads',
    artifactType: { $in: ['ads_asset_call', 'ads_call_asset'] },
    'metadata.slot': slot,
  })
    .sort({ updatedAt: -1 })
    .lean();

  if (!callAsset) {
    const orphanCallConversion = await IntegrationArtifact.findOne({
      businessId,
      provider: 'google_ads',
      artifactType: { $in: ['ads_conversion_action', 'ads_conversion_action_created'] },
      'metadata.logicalCategory': 'call',
    })
      .sort({ updatedAt: -1 })
      .lean();
    if (orphanCallConversion) {
      return {
        status: 'failed',
        checkedAt: orphanCallConversion.updatedAt?.toISOString() ?? null,
        conversionResourceName: orphanCallConversion.metadata?.resourceName ?? null,
        callAssetResourceName: null,
      };
    }
    return {
      status: 'not_checked',
      checkedAt: null,
      conversionResourceName: null,
      callAssetResourceName: null,
    };
  }

  const linkedConversionResourceName =
    typeof callAsset?.metadata?.conversionActionResourceName === 'string'
      ? callAsset.metadata.conversionActionResourceName.trim()
      : null;

  let callConversion = null;
  if (linkedConversionResourceName) {
    callConversion = await IntegrationArtifact.findOne({
      businessId,
      provider: 'google_ads',
      artifactType: { $in: ['ads_conversion_action', 'ads_conversion_action_created'] },
      $or: [
        { 'metadata.resourceName': linkedConversionResourceName },
        { externalId: linkedConversionResourceName.split('/').pop() },
      ],
    })
      .sort({ updatedAt: -1 })
      .lean();
  }

  let status = 'not_checked';
  if (callAsset && callConversion) {
    status = isCallDurationSatisfied(callConversion.metadata) ? 'passed' : 'failed';
  } else if (callAsset) {
    status = 'failed';
  } else if (callConversion && !linkedConversionResourceName) {
    status = 'failed';
  }

  return {
    status,
    checkedAt: callAsset?.updatedAt?.toISOString() ?? callConversion?.updatedAt?.toISOString() ?? null,
    conversionResourceName: linkedConversionResourceName ?? callConversion?.metadata?.resourceName ?? null,
    callAssetResourceName: callAsset?.externalId ?? null,
  };
}

/**
 * Task 31 — compute tracking status per action (calls | forms) for a business.
 *
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function refreshTrackingStatusForBusiness(businessId) {
  const set = await getLeadCampaignSet(businessId);
  if (!set) {
    return null;
  }

  const bc = await BusinessContext.findOne({ businessId }).lean();
  const formTracking = await resolveFormTrackingStatus(businessId);
  const trackingBySlot = {};

  for (const slot of LEAD_CAMPAIGN_SLOTS) {
    if (!set[slot]?.reservedAt) {
      continue;
    }

    const callTracking = await resolveCallTrackingStatus(businessId, slot);

    trackingBySlot[slot] = {
      forms: formTracking,
      calls: callTracking,
    };

    await updateSlot(businessId, slot, { trackingByAction: trackingBySlot[slot] });
  }

  const primarySlot = set.recommended?.reservedAt
    ? 'recommended'
    : set.alternative?.reservedAt
      ? 'alternative'
      : null;
  const trackingByAction = primarySlot ? trackingBySlot[primarySlot] : { forms: {}, calls: {} };

  return {
    businessId: businessId.toString(),
    trackingByAction,
    trackingBySlot,
    businessCountry: bc?.businessCountry ?? null,
  };
}

/**
 * @param {object} slotDoc
 * @param {'calls' | 'forms'} action
 */
function isTrackingPassedForAction(slotDoc, action) {
  const tracking = slotDoc?.trackingByAction?.[action];
  return tracking?.status === 'passed';
}

module.exports = {
  refreshTrackingStatusForBusiness,
  isTrackingPassedForAction,
  resolveFormTrackingStatus,
  resolveCallTrackingStatus,
  isCallDurationSatisfied,
};
