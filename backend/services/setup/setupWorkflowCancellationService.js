'use strict';

const { WorkflowNotFoundError, isGrpcServiceError, isRetryableError } = require('@temporalio/client');
const { getTemporalClient } = require('../../lib/temporalClient');

const TERMINAL_WORKFLOW_STATUSES = new Set([
  'TERMINATED',
  'COMPLETED',
  'FAILED',
  'CANCELED',
  'CANCELLED',
]);

/**
 * Instrumentation: serialize Temporal SDK / gRPC error fields for diagnosis.
 * Uses temporalErrorDetails (not responseBody — that path is Pino-redacted).
 *
 * @param {unknown} err
 */
function temporalErrorLogFields(err) {
  if (!err || typeof err !== 'object') {
    return { temporalErrorDetails: { message: String(err) } };
  }
  const e = /** @type {Record<string, unknown>} */ (err);
  return {
    temporalErrorDetails: {
      name: e.name ?? null,
      message: e.message ?? null,
      code: e.code ?? null,
      cause: e.cause ?? null,
      details: e.details ?? null,
      status: e.status ?? null,
      stack: typeof e.stack === 'string' ? e.stack : null,
    },
  };
}

/**
 * Typed Temporal workflow-absent error only — do not match loose "not found" substrings.
 *
 * @param {unknown} err
 */
function isTypedWorkflowNotFoundError(err) {
  return err instanceof WorkflowNotFoundError;
}

/**
 * @param {unknown} err
 */
function isTransientTemporalRpcError(err) {
  if (isGrpcServiceError(err) && isRetryableError(err)) {
    return true;
  }
  const cause = err && typeof err === 'object' && 'cause' in err ? err.cause : null;
  return isGrpcServiceError(cause) && isRetryableError(cause);
}

/**
 * @param {import('@temporalio/client').WorkflowHandle} handle
 * @param {{ timeoutMs?: number, pollMs?: number }} [options]
 * @param {import('pino').Logger} [logger]
 */
async function waitForWorkflowTerminal(handle, options = {}, logger) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const pollMs = options.pollMs ?? 200;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const desc = await handle.describe();
      const status = typeof desc.status === 'string' ? desc.status : desc.status?.name;
      if (TERMINAL_WORKFLOW_STATUSES.has(String(status))) {
        return status;
      }
    } catch (err) {
      logger?.warn?.(
        { workflowId: handle.workflowId, ...temporalErrorLogFields(err) },
        'prior setup workflow describe failed while waiting for terminal status'
      );
      if (isTypedWorkflowNotFoundError(err)) {
        return 'ABSENT';
      }
      if (isTransientTemporalRpcError(err)) {
        await new Promise((resolve) => setTimeout(resolve, pollMs));
        continue;
      }
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  throw new Error('Timed out waiting for prior setup workflow to terminate');
}

/**
 * Terminate a prior setup workflow and wait until Temporal reports a terminal status.
 *
 * @param {{ _id?: import('mongoose').Types.ObjectId, temporalWorkflowId?: string | null }} priorRun
 * @param {import('pino').Logger} [logger]
 */
async function terminateAndConfirmPriorSetupWorkflow(priorRun, logger) {
  const workflowId = priorRun?.temporalWorkflowId;
  if (!workflowId) {
    logger?.warn?.(
      { setupRunId: priorRun?._id?.toString?.() ?? null },
      'prior setup run has no temporalWorkflowId; skipping workflow terminate'
    );
    return;
  }

  const client = await getTemporalClient();
  const handle = client.workflow.getHandle(workflowId);

  try {
    await handle.terminate('superseded by forced setup restart');
  } catch (err) {
    logger?.warn?.(
      {
        setupRunId: priorRun?._id?.toString?.() ?? null,
        workflowId,
        ...temporalErrorLogFields(err),
      },
      'prior setup workflow terminate failed'
    );
    if (!isTypedWorkflowNotFoundError(err)) {
      throw err;
    }
  }

  const terminalStatus = await waitForWorkflowTerminal(handle, {}, logger);
  logger?.info?.(
    {
      setupRunId: priorRun._id?.toString?.() ?? null,
      workflowId,
      terminalStatus,
    },
    'prior setup workflow terminated before supersede'
  );
}

module.exports = {
  terminateAndConfirmPriorSetupWorkflow,
  waitForWorkflowTerminal,
  TERMINAL_WORKFLOW_STATUSES,
};
