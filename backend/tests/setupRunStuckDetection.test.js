'use strict';

const { detectStuckSetupRun, DEFAULT_STUCK_THRESHOLD_MS } = require('../services/setupRunStuckDetection');

describe('setupRunStuckDetection', () => {
  it('returns not stuck for terminal statuses', () => {
    const result = detectStuckSetupRun({ status: 'SUCCEEDED', updatedAt: new Date() });
    expect(result.stuck).toBe(false);
    expect(result.guidance).toBeNull();
  });

  it('detects RUNNING setup older than threshold as stuck', () => {
    const old = new Date(Date.now() - DEFAULT_STUCK_THRESHOLD_MS - 1000);
    const result = detectStuckSetupRun({ status: 'RUNNING', updatedAt: old });
    expect(result.stuck).toBe(true);
    expect(result.runningForMs).toBeGreaterThanOrEqual(DEFAULT_STUCK_THRESHOLD_MS);
    expect(result.guidance).toMatch(/Temporal worker/i);
  });

  it('does not mark fresh RUNNING setup as stuck', () => {
    const result = detectStuckSetupRun({ status: 'RUNNING', updatedAt: new Date() });
    expect(result.stuck).toBe(false);
  });
});
