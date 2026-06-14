'use strict';

/**
 * Maps a resolved primary goal to the conversion action categories
 * that MUST exist (or be created) before campaign launch.
 *
 * Each entry describes a required "slot" — the workflow must fill
 * every slot with either an existing or newly-created conversion action.
 */
const CONVERSION_SLOTS_BY_GOAL = Object.freeze({
  calls: Object.freeze([
    { slot: 'call', logicalCategory: 'call', required: true },
  ]),
  forms: Object.freeze([
    { slot: 'form', logicalCategory: 'form', required: true },
  ]),
  both: Object.freeze([
    { slot: 'call', logicalCategory: 'call', required: true },
    { slot: 'form', logicalCategory: 'form', required: true },
  ]),
});

/**
 * Default Google Ads ConversionAction configs used when creating
 * a new conversion action to fill an empty slot.
 * These map directly to Google Ads API ConversionAction fields.
 */
const DEFAULT_CONVERSION_ACTION_TEMPLATES = Object.freeze({
  call: Object.freeze({
    name: 'Phone Call Conversions — Zuggernaut',
    category: 'PHONE_CALL_LEAD',
    type: 'AD_CALL',
    countingType: 'ONE_PER_CLICK',
    defaultValue: 0,
    alwaysUseDefaultValue: true,
    status: 'ENABLED',
    includeInConversionsMetric: true,
  }),
  form: Object.freeze({
    name: 'Form Submission Conversions — Zuggernaut',
    category: 'SUBMIT_LEAD_FORM',
    type: 'WEBPAGE',
    countingType: 'ONE_PER_CLICK',
    defaultValue: 0,
    alwaysUseDefaultValue: true,
    status: 'ENABLED',
    includeInConversionsMetric: true,
  }),
});

module.exports = {
  CONVERSION_SLOTS_BY_GOAL,
  DEFAULT_CONVERSION_ACTION_TEMPLATES,
};
