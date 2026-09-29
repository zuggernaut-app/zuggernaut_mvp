'use strict';

const {
  OBJECTIVES,
  STAGES,
  SEGMENTS,
  BUSINESS_SCOPE,
  SEARCH_MVP_EXCLUDED_OBJECTIVES,
  SEARCH_MVP_EXCLUDED_STAGES,
  SEARCH_MVP_EXCLUDED_SEGMENTS,
  BUDGET_TRIM_ORDER,
  BUDGET_TIER_CELL_LIMITS,
  BUDGET_TIER,
  isSalesObjectiveAllowed,
  VALUE_COMPLEXITY_GATE_MAP,
} = require('../../constants/suso');
const {
  resolveFeasibilityGates,
  isObjectiveGateOpen,
} = require('./susoFeasibilityService');

/**
 * @typedef {object} MatrixCell
 * @property {string} objective
 * @property {string} stage
 * @property {string} segment
 * @property {string} label
 * @property {'eligible'|'trimmed'|'gated'} status
 * @property {string} [gateReason]
 */

/** Search MVP viable cells — Layer 1 matrix (objective × stage; segment defaults geographic). */
const SEARCH_MVP_BASE_CELLS = Object.freeze([
  {
    objective: OBJECTIVES.LEADGEN,
    stage: STAGES.CONSIDERATION,
    segment: SEGMENTS.GEOGRAPHIC,
    label: 'Leadgen — consideration (guide/case study)',
  },
  {
    objective: OBJECTIVES.LEADGEN,
    stage: STAGES.CONVERSION,
    segment: SEGMENTS.GEOGRAPHIC,
    label: 'Leadgen — conversion (quote/consult)',
  },
  {
    objective: OBJECTIVES.SALES,
    stage: STAGES.CONSIDERATION,
    segment: SEGMENTS.GEOGRAPHIC,
    label: 'Sales — consideration (generic comparison)',
  },
  {
    objective: OBJECTIVES.SALES,
    stage: STAGES.CONVERSION,
    segment: SEGMENTS.GEOGRAPHIC,
    label: 'Sales — conversion (transactional CTA)',
  },
  {
    objective: OBJECTIVES.RETARGETING,
    stage: STAGES.CONSIDERATION,
    segment: SEGMENTS.BEHAVIORAL,
    label: 'Retargeting — consideration (reminder)',
  },
  {
    objective: OBJECTIVES.RETARGETING,
    stage: STAGES.CONVERSION,
    segment: SEGMENTS.BEHAVIORAL,
    label: 'Retargeting — conversion (last-chance)',
  },
  {
    objective: OBJECTIVES.LOYALTY,
    stage: STAGES.CONVERSION,
    segment: SEGMENTS.GEOGRAPHIC,
    label: 'Loyalty — conversion (branded search)',
  },
]);

/**
 * @param {object} cell
 * @param {string} businessScope
 * @returns {boolean}
 */
function isSegmentAllowedForScope(cell, businessScope) {
  if (SEARCH_MVP_EXCLUDED_SEGMENTS.includes(cell.segment)) {
    return false;
  }
  if (cell.segment === SEGMENTS.GEOGRAPHIC) {
    return (
      businessScope === BUSINESS_SCOPE.LOCAL_SERVICE ||
      businessScope === BUSINESS_SCOPE.REGIONAL ||
      businessScope === BUSINESS_SCOPE.NATIONAL_ONLINE
    );
  }
  if (cell.segment === SEGMENTS.BEHAVIORAL) {
    return businessScope !== BUSINESS_SCOPE.LOCAL_SERVICE || cell.objective === OBJECTIVES.RETARGETING;
  }
  return true;
}

/**
 * @param {object} cell
 * @param {object} bc
 * @param {import('./susoFeasibilityService').FeasibilityGateResult[]} gates
 * @returns {{ eligible: boolean, gateReason?: string }}
 */
function evaluateCellEligibility(cell, bc, gates) {
  if (SEARCH_MVP_EXCLUDED_OBJECTIVES.includes(cell.objective)) {
    return { eligible: false, gateReason: 'Excluded from Search MVP' };
  }
  if (SEARCH_MVP_EXCLUDED_STAGES.includes(cell.stage)) {
    return { eligible: false, gateReason: 'Awareness stage excluded from Search MVP' };
  }
  if (cell.objective === OBJECTIVES.SALES && !isSalesObjectiveAllowed(bc.valueComplexity)) {
    return {
      eligible: false,
      gateReason: 'Sales objective not allowed for this value×complexity profile',
    };
  }
  if (!isObjectiveGateOpen(gates, cell.objective)) {
    return { eligible: false, gateReason: 'Feasibility gate: not enough data yet' };
  }
  if (!isSegmentAllowedForScope(cell, bc.businessScope)) {
    return { eligible: false, gateReason: 'Segment not available for business scope' };
  }
  return { eligible: true };
}

/**
 * @param {MatrixCell[]} eligible
 * @param {string} budgetTier
 * @returns {MatrixCell[]}
 */
function applyBudgetTrim(eligible, budgetTier) {
  const limit = BUDGET_TIER_CELL_LIMITS[budgetTier ?? BUDGET_TIER.STARTER] ?? 2;
  if (eligible.length <= limit) {
    return eligible.map((c) => ({ ...c, status: 'eligible' }));
  }

  const trimRank = new Map();
  BUDGET_TRIM_ORDER.forEach((key, idx) => {
    const id = `${key.stage}|${key.objective}|${key.segment}`;
    trimRank.set(id, idx);
  });

  const sorted = [...eligible].sort((a, b) => {
    const aKey = `${a.stage}|${a.objective}|${a.segment}`;
    const bKey = `${b.stage}|${b.objective}|${b.segment}`;
    return (trimRank.get(bKey) ?? 0) - (trimRank.get(aKey) ?? 0);
  });

  const kept = new Set(
    sorted.slice(0, limit).map((c) => `${c.stage}|${c.objective}|${c.segment}`)
  );

  return eligible.map((cell) => {
    const id = `${cell.stage}|${cell.objective}|${cell.segment}`;
    if (kept.has(id)) {
      return { ...cell, status: 'eligible' };
    }
    return {
      ...cell,
      status: 'trimmed',
      gateReason: 'Trimmed — budget tier cannot support all qualifying cells',
    };
  });
}

/**
 * Build Layer 1 matrix for a business context.
 *
 * @param {object} bc — BusinessContext lean document
 * @returns {{ cells: MatrixCell[], gates: import('./susoFeasibilityService').FeasibilityGateResult[], ctaStyle: string | null }}
 */
function buildSusoMatrix(bc = {}) {
  const gates = resolveFeasibilityGates(bc);
  const ctaStyle = VALUE_COMPLEXITY_GATE_MAP[bc.valueComplexity ?? '']?.ctaStyle ?? null;

  const evaluated = SEARCH_MVP_BASE_CELLS.map((cell) => {
    const { eligible, gateReason } = evaluateCellEligibility(cell, bc, gates);
    return {
      ...cell,
      status: eligible ? 'eligible' : 'gated',
      ...(gateReason ? { gateReason } : {}),
    };
  });

  const eligibleOnly = evaluated.filter((c) => c.status === 'eligible');
  const afterTrim = applyBudgetTrim(eligibleOnly, bc.budgetTier);
  const afterTrimById = new Map(
    afterTrim.map((c) => [`${c.stage}|${c.objective}|${c.segment}`, c])
  );

  const cells = evaluated.map((cell) => {
    const id = `${cell.stage}|${cell.objective}|${cell.segment}`;
    return afterTrimById.get(id) ?? cell;
  });

  return { cells, gates, ctaStyle };
}

module.exports = {
  buildSusoMatrix,
  SEARCH_MVP_BASE_CELLS,
};
