'use strict';

jest.mock('@temporalio/workflow', () => {
  const completeSkeletonSetupActivity = jest.fn();
  const proxyActivities = jest.fn(() => ({ completeSkeletonSetupActivity }));
  return { proxyActivities, completeSkeletonSetupActivity };
});

const temporal = require('@temporalio/workflow');
const { setupRunWorkflow } = require('../workflows/setupRun.workflow');

describe('setupRunWorkflow', () => {
  beforeEach(() => {
    temporal.completeSkeletonSetupActivity.mockReset();
    temporal.completeSkeletonSetupActivity.mockResolvedValue({
      persisted: true,
      greeting: 'done',
      setupRunId: 'run-x',
    });
  });

  it('configures proxied activities', () => {
    expect(temporal.proxyActivities).toHaveBeenCalledWith({
      startToCloseTimeout: '30 seconds',
    });
  });

  it('calls activity with workflow input and returns payload', async () => {
    const out = await setupRunWorkflow({ setupRunId: 'abc', message: 'hello' });

    expect(temporal.completeSkeletonSetupActivity).toHaveBeenCalledWith({
      setupRunId: 'abc',
      message: 'hello',
    });
    expect(out).toEqual({
      workflow: 'setupRunWorkflow',
      greeting: {
        persisted: true,
        greeting: 'done',
        setupRunId: 'run-x',
      },
      setupRunId: 'abc',
    });
  });

  it('normalizes non-object input to empty object', async () => {
    const out = await setupRunWorkflow(null);

    expect(temporal.completeSkeletonSetupActivity).toHaveBeenCalledWith({
      setupRunId: undefined,
      message: undefined,
    });
    expect(out).toMatchObject({
      workflow: 'setupRunWorkflow',
      setupRunId: undefined,
    });
  });
});
