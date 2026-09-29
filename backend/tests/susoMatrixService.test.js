'use strict';

const { buildSusoMatrix } = require('../services/capabilities/susoMatrixService');
const { OBJECTIVES, STAGES } = require('../constants/suso');

describe('susoMatrixService', () => {
  it('offers leadgen cells for a complete low/low local profile', () => {
    const matrix = buildSusoMatrix({
      businessScope: 'local_service',
      valueComplexity: 'low_value_low_complexity',
      budgetTier: 'growth',
      uvp: 'Fast local plumbing',
    });

    const eligible = matrix.cells.filter((c) => c.status === 'eligible');
    expect(eligible.some((c) => c.objective === OBJECTIVES.LEADGEN)).toBe(true);
    expect(eligible.some((c) => c.objective === OBJECTIVES.SALES)).toBe(true);
    expect(matrix.ctaStyle).toBe('buy_now');
  });

  it('gates sales cells when value×complexity disallows sales', () => {
    const matrix = buildSusoMatrix({
      businessScope: 'local_service',
      valueComplexity: 'high_value_high_complexity',
      budgetTier: 'starter',
    });

    const salesCells = matrix.cells.filter((c) => c.objective === OBJECTIVES.SALES);
    expect(salesCells.every((c) => c.status === 'gated')).toBe(true);
    expect(matrix.ctaStyle).toBe('talk_to_us');
  });

  it('gates retargeting and loyalty by default feasibility', () => {
    const matrix = buildSusoMatrix({
      businessScope: 'regional',
      valueComplexity: 'low_value_low_complexity',
      budgetTier: 'scale',
    });

    const retargeting = matrix.cells.filter((c) => c.objective === OBJECTIVES.RETARGETING);
    const loyalty = matrix.cells.filter((c) => c.objective === OBJECTIVES.LOYALTY);
    expect(retargeting.every((c) => c.status === 'gated')).toBe(true);
    expect(loyalty.every((c) => c.status === 'gated')).toBe(true);
  });

  it('excludes awareness stage from Search MVP cells', () => {
    const matrix = buildSusoMatrix({
      businessScope: 'local_service',
      valueComplexity: 'low_value_low_complexity',
      budgetTier: 'scale',
    });
    expect(matrix.cells.some((c) => c.stage === STAGES.AWARENESS)).toBe(false);
  });

  it('trims cells on starter budget tier', () => {
    const matrix = buildSusoMatrix({
      businessScope: 'local_service',
      valueComplexity: 'low_value_low_complexity',
      budgetTier: 'starter',
    });
    const trimmed = matrix.cells.filter((c) => c.status === 'trimmed');
    const eligible = matrix.cells.filter((c) => c.status === 'eligible');
    expect(eligible.length).toBeLessThanOrEqual(2);
    expect(trimmed.length).toBeGreaterThan(0);
  });
});
