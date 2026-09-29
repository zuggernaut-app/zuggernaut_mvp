'use strict';

const {
  FEASIBILITY_GATE_STATES,
  OBJECTIVES,
} = require('../../constants/suso');

/**
 * @typedef {object} FeasibilityGateResult
 * @property {string} gate — 'retargeting' | 'loyalty' | 'budget'
 * @property {string} state — FEASIBILITY_GATE_STATES value
 * @property {string} label
 * @property {string} [detail]
 */

/**
 * V1: retargeting and loyalty default to "not enough data yet" until Google Ads reporting wired.
 *
 * @param {object} [_bc] — BusinessContext lean document (reserved for future reporting)
 * @returns {FeasibilityGateResult[]}
 */
function resolveFeasibilityGates(_bc = {}) {
  return [
    {
      gate: 'retargeting',
      state: FEASIBILITY_GATE_STATES.NOT_ENOUGH_DATA,
      label: 'Retargeting (RLSA)',
      detail:
        'Requires existing tag/pixel and minimum RLSA audience volume. Connect reporting to verify.',
    },
    {
      gate: 'loyalty',
      state: FEASIBILITY_GATE_STATES.NOT_ENOUGH_DATA,
      label: 'Loyalty / branded search',
      detail:
        'Requires verifiable branded search volume on Search. Connect reporting to verify.',
    },
    {
      gate: 'budget',
      state: FEASIBILITY_GATE_STATES.PASSED,
      label: 'Budget viability',
      detail: 'Budget tier will be checked against qualifying matrix cells.',
    },
  ];
}

/**
 * @param {FeasibilityGateResult[]} gates
 * @param {'retargeting'|'loyalty'} gateName
 * @returns {boolean}
 */
function isObjectiveFeasible(gates, gateName) {
  const row = gates.find((g) => g.gate === gateName);
  return row?.state === FEASIBILITY_GATE_STATES.PASSED;
}

/**
 * @param {FeasibilityGateResult[]} gates
 * @param {string} objective
 * @returns {boolean}
 */
function isObjectiveGateOpen(gates, objective) {
  if (objective === OBJECTIVES.RETARGETING) {
    return isObjectiveFeasible(gates, 'retargeting');
  }
  if (objective === OBJECTIVES.LOYALTY) {
    return isObjectiveFeasible(gates, 'loyalty');
  }
  return true;
}

module.exports = {
  resolveFeasibilityGates,
  isObjectiveFeasible,
  isObjectiveGateOpen,
};
