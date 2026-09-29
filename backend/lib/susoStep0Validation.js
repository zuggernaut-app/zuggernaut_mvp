'use strict';

const {
  BUSINESS_SCOPE,
  VALUE_COMPLEXITY,
  BUDGET_TIER,
  STEP_0_FIELDS,
  isSalesObjectiveAllowed,
} = require('../constants/suso');

/**
 * @param {unknown} val
 * @returns {{ ok: true, value: object | undefined } | { ok: false, message: string }}
 */
function validateCompetitorLandscape(val) {
  if (val === null || val === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof val !== 'object' || Array.isArray(val)) {
    return { ok: false, message: 'competitorLandscape must be an object or null' };
  }
  const obj = val;
  if (obj.competitors !== undefined) {
    if (!Array.isArray(obj.competitors)) {
      return { ok: false, message: 'competitorLandscape.competitors must be an array' };
    }
    for (let i = 0; i < obj.competitors.length; i += 1) {
      const row = obj.competitors[i];
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        return { ok: false, message: `competitorLandscape.competitors[${i}] must be an object` };
      }
      if (typeof row.name !== 'string' || !row.name.trim()) {
        return {
          ok: false,
          message: `competitorLandscape.competitors[${i}].name is required`,
        };
      }
    }
  }
  return { ok: true, value: obj };
}

/**
 * @param {object} body
 * @returns {boolean}
 */
function bodyIncludesAnyStep0Field(body) {
  return STEP_0_FIELDS.some((field) => Object.prototype.hasOwnProperty.call(body, field));
}

/**
 * Validate Step 0 fields present in PUT body. Review confirm may omit Step 0 entirely.
 *
 * @param {object} body
 * @param {object} doc — BusinessContext document after field application
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
function validateStep0Put(body, doc) {
  if (!bodyIncludesAnyStep0Field(body)) {
    return { ok: true };
  }

  if (Object.prototype.hasOwnProperty.call(body, 'businessScope')) {
    const scope = doc.businessScope;
    if (scope && !Object.values(BUSINESS_SCOPE).includes(scope)) {
      return { ok: false, message: 'businessScope is invalid' };
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'valueComplexity')) {
    const vc = doc.valueComplexity;
    if (vc && !Object.values(VALUE_COMPLEXITY).includes(vc)) {
      return { ok: false, message: 'valueComplexity is invalid' };
    }
  }

  if (Object.prototype.hasOwnProperty.call(body, 'budgetTier')) {
    const tier = doc.budgetTier;
    if (tier && !Object.values(BUDGET_TIER).includes(tier)) {
      return { ok: false, message: 'budgetTier is invalid' };
    }
  }

  const completingStep0 =
    typeof doc.uvp === 'string' &&
    doc.uvp.trim() &&
    doc.businessScope &&
    doc.valueComplexity &&
    doc.budgetTier;

  if (completingStep0 && !isSalesObjectiveAllowed(doc.valueComplexity)) {
    // Value×complexity gate — sales cells gated in matrix; no invalid PUT state.
    return { ok: true };
  }

  return { ok: true };
}

/**
 * @param {object} doc — mongoose document
 * @returns {Record<string, string | null>}
 */
function snapshotStep0Fields(doc) {
  return {
    uvp: typeof doc.uvp === 'string' ? doc.uvp.trim() : '',
    competitorLandscape: JSON.stringify(doc.competitorLandscape ?? null),
    businessScope: doc.businessScope ?? '',
    valueComplexity: doc.valueComplexity ?? '',
    budgetTier: doc.budgetTier ?? '',
  };
}

/**
 * @param {Record<string, string | null>} before
 * @param {Record<string, string | null>} after
 * @returns {boolean}
 */
function step0FieldsChanged(before, after) {
  return STEP_0_FIELDS.some((field) => {
    if (field === 'competitorLandscape') {
      return before.competitorLandscape !== after.competitorLandscape;
    }
    return before[field] !== after[field];
  });
}

function extractCompetitorNames(competitorLandscape) {
  if (!competitorLandscape || typeof competitorLandscape !== 'object' || Array.isArray(competitorLandscape)) {
    return [];
  }
  const competitors = competitorLandscape.competitors;
  if (!Array.isArray(competitors)) return [];
  return competitors
    .map((row) => (row && typeof row.name === 'string' ? row.name.trim() : ''))
    .filter(Boolean);
}

/**
 * @param {object | null | undefined} bc
 * @returns {boolean}
 */
function isStep0Complete(bc) {
  return (
    typeof bc?.uvp === 'string' &&
    bc.uvp.trim().length > 0 &&
    Boolean(bc?.businessScope) &&
    Boolean(bc?.valueComplexity) &&
    Boolean(bc?.budgetTier)
  );
}

module.exports = {
  validateCompetitorLandscape,
  bodyIncludesAnyStep0Field,
  validateStep0Put,
  snapshotStep0Fields,
  step0FieldsChanged,
  extractCompetitorNames,
  isStep0Complete,
  STEP_0_FIELDS,
};
