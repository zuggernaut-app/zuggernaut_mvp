'use strict';

/**
 * SUSO framework constants — rules stay in code/config for V1.
 * @see docs/suso-framework/SUSO-framework-full-v2.1.md
 * @see docs/suso-framework/SUSO-google-search-ads-mvp-v2.1.md
 */

const OBJECTIVES = Object.freeze({
  LEADGEN: 'leadgen',
  SALES: 'sales',
  RETARGETING: 'retargeting',
  LOYALTY: 'loyalty',
  BRANDING: 'branding',
});

const STAGES = Object.freeze({
  AWARENESS: 'awareness',
  CONSIDERATION: 'consideration',
  CONVERSION: 'conversion',
});

const SEGMENTS = Object.freeze({
  DEMOGRAPHIC: 'demographic',
  GEOGRAPHIC: 'geographic',
  BEHAVIORAL: 'behavioral',
  PSYCHOGRAPHIC: 'psychographic',
});

const FEASIBILITY_GATE_STATES = Object.freeze({
  PASSED: 'passed',
  FAILED: 'failed',
  NOT_ENOUGH_DATA: 'not_enough_data_yet',
});

const BUSINESS_SCOPE = Object.freeze({
  LOCAL_SERVICE: 'local_service',
  REGIONAL: 'regional',
  NATIONAL_ONLINE: 'national_online',
});

const VALUE_COMPLEXITY = Object.freeze({
  LOW_LOW: 'low_value_low_complexity',
  LOW_HIGH: 'low_value_high_complexity',
  HIGH_LOW: 'high_value_low_complexity',
  HIGH_HIGH: 'high_value_high_complexity',
});

const BUDGET_TIER = Object.freeze({
  STARTER: 'starter',
  GROWTH: 'growth',
  SCALE: 'scale',
});

/** Search MVP — excluded objectives per SUSO-google-search-ads-mvp-v2.1.md */
const SEARCH_MVP_EXCLUDED_OBJECTIVES = Object.freeze([OBJECTIVES.BRANDING]);

/** Search MVP — excluded stages (awareness folds into consideration messaging). */
const SEARCH_MVP_EXCLUDED_STAGES = Object.freeze([STAGES.AWARENESS]);

/** Search MVP — psychographic parked until Display/YouTube. */
const SEARCH_MVP_EXCLUDED_SEGMENTS = Object.freeze([SEGMENTS.PSYCHOGRAPHIC]);

/**
 * Value×complexity → whether Sales/Conversion objective is allowed.
 * @type {Record<string, { salesAllowed: boolean, ctaStyle: string }>}
 */
const VALUE_COMPLEXITY_GATE_MAP = Object.freeze({
  [VALUE_COMPLEXITY.LOW_LOW]: { salesAllowed: true, ctaStyle: 'buy_now' },
  [VALUE_COMPLEXITY.LOW_HIGH]: { salesAllowed: false, ctaStyle: 'informational_soft' },
  [VALUE_COMPLEXITY.HIGH_LOW]: { salesAllowed: false, ctaStyle: 'book_demo' },
  [VALUE_COMPLEXITY.HIGH_HIGH]: { salesAllowed: false, ctaStyle: 'talk_to_us' },
});

/**
 * Budget trim priority — lowest trimmed first.
 * Stage: Conversion > Consideration > Awareness
 * Objective: Leadgen > Sales > Retargeting > Loyalty
 * Segment: Geographic > Demographic > Behavioral
 */
const BUDGET_TRIM_ORDER = Object.freeze([
  { stage: STAGES.AWARENESS, objective: OBJECTIVES.LOYALTY, segment: SEGMENTS.BEHAVIORAL },
  { stage: STAGES.AWARENESS, objective: OBJECTIVES.LOYALTY, segment: SEGMENTS.DEMOGRAPHIC },
  { stage: STAGES.AWARENESS, objective: OBJECTIVES.LOYALTY, segment: SEGMENTS.GEOGRAPHIC },
  { stage: STAGES.AWARENESS, objective: OBJECTIVES.RETARGETING, segment: SEGMENTS.BEHAVIORAL },
  { stage: STAGES.AWARENESS, objective: OBJECTIVES.RETARGETING, segment: SEGMENTS.DEMOGRAPHIC },
  { stage: STAGES.AWARENESS, objective: OBJECTIVES.RETARGETING, segment: SEGMENTS.GEOGRAPHIC },
  { stage: STAGES.AWARENESS, objective: OBJECTIVES.SALES, segment: SEGMENTS.BEHAVIORAL },
  { stage: STAGES.AWARENESS, objective: OBJECTIVES.SALES, segment: SEGMENTS.DEMOGRAPHIC },
  { stage: STAGES.AWARENESS, objective: OBJECTIVES.SALES, segment: SEGMENTS.GEOGRAPHIC },
  { stage: STAGES.AWARENESS, objective: OBJECTIVES.LEADGEN, segment: SEGMENTS.BEHAVIORAL },
  { stage: STAGES.AWARENESS, objective: OBJECTIVES.LEADGEN, segment: SEGMENTS.DEMOGRAPHIC },
  { stage: STAGES.AWARENESS, objective: OBJECTIVES.LEADGEN, segment: SEGMENTS.GEOGRAPHIC },
  { stage: STAGES.CONSIDERATION, objective: OBJECTIVES.LOYALTY, segment: SEGMENTS.BEHAVIORAL },
  { stage: STAGES.CONSIDERATION, objective: OBJECTIVES.LOYALTY, segment: SEGMENTS.DEMOGRAPHIC },
  { stage: STAGES.CONSIDERATION, objective: OBJECTIVES.LOYALTY, segment: SEGMENTS.GEOGRAPHIC },
  { stage: STAGES.CONSIDERATION, objective: OBJECTIVES.RETARGETING, segment: SEGMENTS.BEHAVIORAL },
  { stage: STAGES.CONSIDERATION, objective: OBJECTIVES.RETARGETING, segment: SEGMENTS.DEMOGRAPHIC },
  { stage: STAGES.CONSIDERATION, objective: OBJECTIVES.RETARGETING, segment: SEGMENTS.GEOGRAPHIC },
  { stage: STAGES.CONSIDERATION, objective: OBJECTIVES.SALES, segment: SEGMENTS.BEHAVIORAL },
  { stage: STAGES.CONSIDERATION, objective: OBJECTIVES.SALES, segment: SEGMENTS.DEMOGRAPHIC },
  { stage: STAGES.CONSIDERATION, objective: OBJECTIVES.SALES, segment: SEGMENTS.GEOGRAPHIC },
  { stage: STAGES.CONSIDERATION, objective: OBJECTIVES.LEADGEN, segment: SEGMENTS.BEHAVIORAL },
  { stage: STAGES.CONSIDERATION, objective: OBJECTIVES.LEADGEN, segment: SEGMENTS.DEMOGRAPHIC },
  { stage: STAGES.CONSIDERATION, objective: OBJECTIVES.LEADGEN, segment: SEGMENTS.GEOGRAPHIC },
  { stage: STAGES.CONVERSION, objective: OBJECTIVES.LOYALTY, segment: SEGMENTS.BEHAVIORAL },
  { stage: STAGES.CONVERSION, objective: OBJECTIVES.LOYALTY, segment: SEGMENTS.DEMOGRAPHIC },
  { stage: STAGES.CONVERSION, objective: OBJECTIVES.LOYALTY, segment: SEGMENTS.GEOGRAPHIC },
  { stage: STAGES.CONVERSION, objective: OBJECTIVES.RETARGETING, segment: SEGMENTS.BEHAVIORAL },
  { stage: STAGES.CONVERSION, objective: OBJECTIVES.RETARGETING, segment: SEGMENTS.DEMOGRAPHIC },
  { stage: STAGES.CONVERSION, objective: OBJECTIVES.RETARGETING, segment: SEGMENTS.GEOGRAPHIC },
  { stage: STAGES.CONVERSION, objective: OBJECTIVES.SALES, segment: SEGMENTS.BEHAVIORAL },
  { stage: STAGES.CONVERSION, objective: OBJECTIVES.SALES, segment: SEGMENTS.DEMOGRAPHIC },
  { stage: STAGES.CONVERSION, objective: OBJECTIVES.SALES, segment: SEGMENTS.GEOGRAPHIC },
  { stage: STAGES.CONVERSION, objective: OBJECTIVES.LEADGEN, segment: SEGMENTS.BEHAVIORAL },
  { stage: STAGES.CONVERSION, objective: OBJECTIVES.LEADGEN, segment: SEGMENTS.DEMOGRAPHIC },
  { stage: STAGES.CONVERSION, objective: OBJECTIVES.LEADGEN, segment: SEGMENTS.GEOGRAPHIC },
]);

/** Max matrix cells supported per budget tier (Search MVP). */
const BUDGET_TIER_CELL_LIMITS = Object.freeze({
  [BUDGET_TIER.STARTER]: 2,
  [BUDGET_TIER.GROWTH]: 4,
  [BUDGET_TIER.SCALE]: 8,
});

/** Daily budget micros per tier — used when wiring matrix → intent (Batch 2). */
const BUDGET_TIER_DAILY_MICROS = Object.freeze({
  [BUDGET_TIER.STARTER]: 10_000_000,
  [BUDGET_TIER.GROWTH]: 25_000_000,
  [BUDGET_TIER.SCALE]: 50_000_000,
});

const STEP_0_FIELDS = Object.freeze([
  'uvp',
  'competitorLandscape',
  'businessScope',
  'valueComplexity',
  'budgetTier',
]);

/**
 * @param {string | null | undefined} valueComplexity
 * @returns {boolean}
 */
function isSalesObjectiveAllowed(valueComplexity) {
  const gate = VALUE_COMPLEXITY_GATE_MAP[valueComplexity ?? ''];
  return gate?.salesAllowed === true;
}

module.exports = {
  OBJECTIVES,
  STAGES,
  SEGMENTS,
  FEASIBILITY_GATE_STATES,
  BUSINESS_SCOPE,
  VALUE_COMPLEXITY,
  BUDGET_TIER,
  SEARCH_MVP_EXCLUDED_OBJECTIVES,
  SEARCH_MVP_EXCLUDED_STAGES,
  SEARCH_MVP_EXCLUDED_SEGMENTS,
  VALUE_COMPLEXITY_GATE_MAP,
  BUDGET_TRIM_ORDER,
  BUDGET_TIER_CELL_LIMITS,
  BUDGET_TIER_DAILY_MICROS,
  STEP_0_FIELDS,
  isSalesObjectiveAllowed,
};
