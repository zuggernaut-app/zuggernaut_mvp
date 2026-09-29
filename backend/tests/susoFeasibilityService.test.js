'use strict';

const {
  resolveFeasibilityGates,
  isObjectiveGateOpen,
} = require('../services/capabilities/susoFeasibilityService');
const {
  FEASIBILITY_GATE_STATES,
  OBJECTIVES,
} = require('../constants/suso');

describe('susoFeasibilityService', () => {
  it('defaults retargeting and loyalty to not_enough_data_yet in V1', () => {
    const gates = resolveFeasibilityGates({});
    const retargeting = gates.find((g) => g.gate === 'retargeting');
    const loyalty = gates.find((g) => g.gate === 'loyalty');
    const budget = gates.find((g) => g.gate === 'budget');

    expect(retargeting?.state).toBe(FEASIBILITY_GATE_STATES.NOT_ENOUGH_DATA);
    expect(loyalty?.state).toBe(FEASIBILITY_GATE_STATES.NOT_ENOUGH_DATA);
    expect(budget?.state).toBe(FEASIBILITY_GATE_STATES.PASSED);
  });

  it('blocks retargeting and loyalty objectives when gates are not passed', () => {
    const gates = resolveFeasibilityGates({});
    expect(isObjectiveGateOpen(gates, OBJECTIVES.RETARGETING)).toBe(false);
    expect(isObjectiveGateOpen(gates, OBJECTIVES.LOYALTY)).toBe(false);
    expect(isObjectiveGateOpen(gates, OBJECTIVES.LEADGEN)).toBe(true);
  });
});
