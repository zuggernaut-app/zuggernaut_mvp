'use strict';

const mongoose = require('mongoose');
const { getLeadCampaignSet } = require('./leadCampaignSetService');
const { resolvePrimaryGoal } = require('./adsConversionCatalogService');
const {
  isConversionAfterStart,
  pickConversionForGoal,
  trackingTestPassedForRun,
} = require('./businessSetupTrackingTestLogic');
const {
  fetchConversionActionsWithRecentDates,
  GoogleAdsApiError,
} = require('../integrations/googleAdsConversionCatalogClient');

const LeadCampaignSet = mongoose.model('LeadCampaignSet');
const BusinessContext = mongoose.model('BusinessContext');

class BusinessSetupTrackingTestError extends Error {
  constructor(message, code = 'BUSINESS_SETUP_TRACKING_TEST_ERROR') {
    super(message);
    this.name = 'BusinessSetupTrackingTestError';
    this.code = code;
  }
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function startTrackingTest(businessId) {
  const biz =
    businessId instanceof mongoose.Types.ObjectId
      ? businessId
      : new mongoose.Types.ObjectId(businessId);
  const startedAt = new Date();
  const doc = await LeadCampaignSet.findOneAndUpdate(
    { businessId: biz },
    {
      $set: { trackingTestStartedAt: startedAt, trackingTestResult: null },
      $setOnInsert: { businessId: biz },
    },
    { upsert: true, new: true }
  );
  if (!doc) {
    throw new BusinessSetupTrackingTestError('Could not start tracking test.', 'not_found');
  }
  return { trackingTestStartedAt: startedAt.toISOString() };
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function pollTrackingTest(businessId) {
  const biz =
    businessId instanceof mongoose.Types.ObjectId
      ? businessId
      : new mongoose.Types.ObjectId(businessId);
  const set = await getLeadCampaignSet(biz);
  const startedAt = set?.trackingTestStartedAt;
  if (!startedAt) {
    throw new BusinessSetupTrackingTestError(
      'Start the tracking test before checking results.',
      'validation_error'
    );
  }

  const bc = await BusinessContext.findOne({ businessId: biz }).lean();
  const primary = resolvePrimaryGoal(bc?.goals);
  const goals = [];
  if (primary === 'forms' || primary === 'both') goals.push('forms');
  if (primary === 'calls' || primary === 'both') goals.push('calls');

  let actions;
  try {
    actions = await fetchConversionActionsWithRecentDates(biz);
  } catch (err) {
    if (err instanceof GoogleAdsApiError) {
      throw new BusinessSetupTrackingTestError(err.message, err.code);
    }
    throw err;
  }

  const result = {};
  for (const goal of goals) {
    const conv = pickConversionForGoal(actions, goal);
    if (!conv) {
      result[goal] = 'no_conversion_action';
      continue;
    }
    const recent = conv.mostRecentConversionDate;
    if (!recent) {
      result[goal] = 'not_fired';
      continue;
    }
    result[goal] = isConversionAfterStart(recent, startedAt) ? 'pass' : 'not_fired';
  }

  await LeadCampaignSet.findOneAndUpdate(
    { businessId: biz },
    { $set: { trackingTestResult: result } },
    { upsert: true }
  );

  return { goals: result, trackingTestStartedAt: startedAt.toISOString() };
}

module.exports = {
  BusinessSetupTrackingTestError,
  startTrackingTest,
  pollTrackingTest,
  trackingTestPassedForRun,
};
