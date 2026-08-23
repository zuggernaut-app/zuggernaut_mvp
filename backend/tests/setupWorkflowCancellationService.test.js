'use strict';

jest.mock('../lib/temporalClient', () => ({
  getTemporalClient: jest.fn(),
}));

const { WorkflowNotFoundError } = require('@temporalio/client');
const { getTemporalClient } = require('../lib/temporalClient');
const {
  terminateAndConfirmPriorSetupWorkflow,
  waitForWorkflowTerminal,
} = require('../services/setup/setupWorkflowCancellationService');

describe('setupWorkflowCancellationService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('confirms when terminate returns WorkflowNotFoundError and describe reports terminal', async () => {
    const terminate = jest
      .fn()
      .mockRejectedValue(new WorkflowNotFoundError('setup-run-prior', 'default', 'run-1'));
    const describe = jest.fn().mockResolvedValue({ status: { name: 'COMPLETED' } });
    getTemporalClient.mockResolvedValue({
      workflow: {
        getHandle: jest.fn().mockReturnValue({ workflowId: 'setup-run-prior', terminate, describe }),
      },
    });

    await expect(
      terminateAndConfirmPriorSetupWorkflow(
        { _id: 'abc', temporalWorkflowId: 'setup-run-prior' },
        null
      )
    ).resolves.toBeUndefined();

    expect(describe).toHaveBeenCalled();
  });

  it('confirms when terminate and describe both return WorkflowNotFoundError (absent execution)', async () => {
    const terminate = jest
      .fn()
      .mockRejectedValue(new WorkflowNotFoundError('setup-run-prior', 'default', 'run-1'));
    const describe = jest
      .fn()
      .mockRejectedValue(new WorkflowNotFoundError('setup-run-prior', 'default', 'run-1'));
    getTemporalClient.mockResolvedValue({
      workflow: {
        getHandle: jest.fn().mockReturnValue({ workflowId: 'setup-run-prior', terminate, describe }),
      },
    });

    await expect(
      terminateAndConfirmPriorSetupWorkflow(
        { _id: 'abc', temporalWorkflowId: 'setup-run-prior' },
        null
      )
    ).resolves.toBeUndefined();
  });

  it('does not treat loose not-found messages as workflow absent on terminate', async () => {
    const terminate = jest.fn().mockRejectedValue(new Error('namespace not found'));
    getTemporalClient.mockResolvedValue({
      workflow: {
        getHandle: jest.fn().mockReturnValue({ workflowId: 'setup-run-prior', terminate }),
      },
    });

    await expect(
      terminateAndConfirmPriorSetupWorkflow(
        { _id: 'abc', temporalWorkflowId: 'setup-run-prior' },
        null
      )
    ).rejects.toThrow('namespace not found');
  });

  it('retries transient describe failures before confirming terminal', async () => {
    const grpc = require('@grpc/grpc-js');
    const transient = Object.assign(new Error('unavailable'), {
      code: grpc.status.UNAVAILABLE,
      details: 'unavailable',
      metadata: {},
    });
    const describe = jest
      .fn()
      .mockRejectedValueOnce(transient)
      .mockResolvedValueOnce({ status: { name: 'TERMINATED' } });

    const status = await waitForWorkflowTerminal(
      { workflowId: 'setup-run-prior', describe },
      { pollMs: 1, timeoutMs: 500 },
      null
    );

    expect(status).toBe('TERMINATED');
    expect(describe).toHaveBeenCalledTimes(2);
  });
});
