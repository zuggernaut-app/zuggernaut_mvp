'use strict';

const { SETUP_ACTIVITY_POLICIES } = require('../constants/setupActivityPolicies');

describe('setupActivityPolicies', () => {
  it('defines explicit timeout and retry policies for each activity group', () => {
    expect(SETUP_ACTIVITY_POLICIES.control.startToCloseTimeout).toBe('2 minutes');
    expect(SETUP_ACTIVITY_POLICIES.precondition.retry.maximumAttempts).toBe(2);
    expect(SETUP_ACTIVITY_POLICIES.read.retry.maximumAttempts).toBe(4);
    expect(SETUP_ACTIVITY_POLICIES.mutate.startToCloseTimeout).toBe('10 minutes');
    expect(SETUP_ACTIVITY_POLICIES.mutate.scheduleToCloseTimeout).toBe('20 minutes');
    expect(SETUP_ACTIVITY_POLICIES.mutate.retry.maximumAttempts).toBe(3);
    expect(SETUP_ACTIVITY_POLICIES.read.scheduleToCloseTimeout).toBe('12 minutes');
  });

  it('uses shorter retries for precondition checks than provider mutations', () => {
    expect(SETUP_ACTIVITY_POLICIES.precondition.retry.maximumInterval).toBe('10s');
    expect(SETUP_ACTIVITY_POLICIES.mutate.retry.maximumInterval).toBe('90s');
  });

  it('keeps mutate retries bounded for idempotent provider activities', () => {
    expect(SETUP_ACTIVITY_POLICIES.mutate.retry.maximumAttempts).toBeLessThanOrEqual(3);
    expect(SETUP_ACTIVITY_POLICIES.precondition.retry.maximumAttempts).toBeLessThan(
      SETUP_ACTIVITY_POLICIES.read.retry.maximumAttempts
    );
  });
});
