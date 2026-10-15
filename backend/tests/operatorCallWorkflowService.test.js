'use strict';

const { resolveOperatorListStatus } = require('../services/capabilities/operatorCallWorkflowService');

describe('resolveOperatorListStatus', () => {
  it('returns signup_not_finished when signup incomplete', () => {
    expect(resolveOperatorListStatus({ signupCompletedAt: null })).toBe('signup_not_finished');
  });

  it('returns signup_complete when signup done and no flags', () => {
    expect(
      resolveOperatorListStatus({
        signupCompletedAt: new Date(),
        operatorCallWorkflow: {},
      }),
    ).toBe('signup_complete');
  });

  it('returns needs_operator_follow_up when flagged', () => {
    expect(
      resolveOperatorListStatus({
        signupCompletedAt: new Date(),
        operatorCallWorkflow: { needsOperatorFollowUp: true },
      }),
    ).toBe('needs_operator_follow_up');
  });
});
