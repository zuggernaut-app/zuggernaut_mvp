'use strict';

const mongoose = require('mongoose');
const { ApplicationFailure } = require('@temporalio/activity');

/**
 * Parse and validate setup activity input IDs.
 * @param {{ setupRunId?: string, businessId?: string }} input
 * @param {{ requireBusinessId?: boolean }} [opts]
 */
function parseSetupActivityIds(input, { requireBusinessId = true } = {}) {
  const rawRun = typeof input?.setupRunId === 'string' ? input.setupRunId.trim() : '';
  const rawBiz = typeof input?.businessId === 'string' ? input.businessId.trim() : '';

  if (!rawRun || !mongoose.Types.ObjectId.isValid(rawRun)) {
    throw ApplicationFailure.nonRetryable('Invalid or missing setupRunId', 'SetupValidationError');
  }

  if (requireBusinessId && (!rawBiz || !mongoose.Types.ObjectId.isValid(rawBiz))) {
    throw ApplicationFailure.nonRetryable('Invalid or missing businessId', 'SetupValidationError');
  }

  return {
    rawRun,
    rawBiz,
    setupRunId: new mongoose.Types.ObjectId(rawRun),
    businessId: requireBusinessId ? new mongoose.Types.ObjectId(rawBiz) : null,
  };
}

/**
 * Derive a dashboard-safe error summary (no secrets/tokens in messages).
 * @param {unknown} err
 * @param {string} fallback
 */
function safeErrorMessage(err, fallback) {
  const msg = err instanceof Error ? err.message : fallback;
  if (/token|secret|password|bearer|refresh/i.test(msg)) {
    return fallback;
  }
  return msg;
}

module.exports = { parseSetupActivityIds, safeErrorMessage };
