'use strict';

const { ApplicationFailure } = require('@temporalio/activity');
const { parseSetupActivityIds, safeErrorMessage } = require('../activities/lib/setupActivityInput');

describe('setupActivityInput', () => {
  it('parseSetupActivityIds rejects invalid setupRunId', () => {
    expect(() => parseSetupActivityIds({ setupRunId: 'bad', businessId: '507f1f77bcf86cd799439011' }))
      .toThrow(ApplicationFailure);
    try {
      parseSetupActivityIds({ setupRunId: 'bad', businessId: '507f1f77bcf86cd799439011' });
    } catch (err) {
      expect(err.type).toBe('SetupValidationError');
    }
  });

  it('parseSetupActivityIds rejects invalid businessId', () => {
    try {
      parseSetupActivityIds({ setupRunId: '507f1f77bcf86cd799439011', businessId: 'bad' });
    } catch (err) {
      expect(err.type).toBe('SetupValidationError');
      expect(err.message).toContain('businessId');
    }
  });

  it('parseSetupActivityIds returns ObjectIds for valid input', () => {
    const runId = '507f1f77bcf86cd799439011';
    const bizId = '507f1f77bcf86cd799439012';
    const parsed = parseSetupActivityIds({ setupRunId: runId, businessId: bizId });
    expect(parsed.rawRun).toBe(runId);
    expect(parsed.rawBiz).toBe(bizId);
    expect(parsed.setupRunId.toString()).toBe(runId);
    expect(parsed.businessId.toString()).toBe(bizId);
  });

  it('safeErrorMessage redacts token-like messages', () => {
    const err = new Error('refresh token expired: abc123secret');
    expect(safeErrorMessage(err, 'fallback')).toBe('fallback');
  });

  it('safeErrorMessage passes through safe messages', () => {
    const err = new Error('GTM containerId missing');
    expect(safeErrorMessage(err, 'fallback')).toBe('GTM containerId missing');
  });
});
