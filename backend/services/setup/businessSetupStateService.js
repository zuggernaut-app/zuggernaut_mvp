'use strict';

const mongoose = require('mongoose');
const BusinessSetupState = mongoose.model('BusinessSetupState');
const SetupRun = mongoose.model('SetupRun');
const {
  SETUP_CLAIM_LEASE_MS,
  SETUP_RUN_TERMINAL_LOCK_STATUSES,
} = require('../../constants/businessSetupState');

class SetupStartError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, unknown>} [details]
   */
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'SetupStartError';
    this.code = code;
    this.details = details;
  }
}

class SetupRunSupersededError extends Error {
  constructor(message = 'Setup run is no longer the active run for this business') {
    super(message);
    this.name = 'SetupRunSupersededError';
    this.code = 'SETUP_RUN_SUPERSEDED';
  }
}

const TERMINAL_STATUS_SET = new Set(SETUP_RUN_TERMINAL_LOCK_STATUSES);

/**
 * @param {string} status
 */
function isTerminalSetupRunStatus(status) {
  return TERMINAL_STATUS_SET.has(status);
}

/**
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
function toBusinessObjectId(businessId) {
  if (businessId instanceof mongoose.Types.ObjectId) return businessId;
  return new mongoose.Types.ObjectId(businessId);
}

/**
 * Bootstrap lock row from latest SetupRun when migrating existing businesses.
 * @param {import('mongoose').Types.ObjectId} businessId
 */
async function ensureBusinessSetupStateSynced(businessId) {
  const exists = await BusinessSetupState.exists({ businessId });
  if (exists) return;

  const latest = await SetupRun.findOne({ businessId }).sort({ updatedAt: -1 }).lean();
  if (!latest) return;

  let lockState = 'idle';
  if (latest.status === 'SUCCEEDED') {
    lockState = 'succeeded';
  } else if (latest.status === 'FAILED' || isTerminalSetupRunStatus(latest.status)) {
    lockState = 'failed';
  } else {
    lockState = 'running';
  }

  try {
    await BusinessSetupState.create({
      businessId,
      lockState,
      activeSetupRunId: lockState === 'running' ? latest._id : undefined,
      generation: 1,
    });
  } catch (err) {
    if (err?.code !== 11000) throw err;
  }
}

/**
 * Atomically claim a setup start for a business.
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {{ force?: boolean }} [options]
 * @returns {Promise<{ generation: number, superseded?: boolean, priorSetupRunId?: string }>}
 */
async function claimSetupStart(businessId, options = {}) {
  const force = options.force === true;
  const bid = toBusinessObjectId(businessId);
  await ensureBusinessSetupStateSynced(bid);

  const now = new Date();
  const leaseUntil = new Date(now.getTime() + SETUP_CLAIM_LEASE_MS);

  const existing = await BusinessSetupState.findOne({ businessId: bid });
  if (!existing) {
    try {
      await BusinessSetupState.create({
        businessId: bid,
        lockState: 'claiming',
        claimLeaseExpiresAt: leaseUntil,
        generation: 1,
      });
      return { generation: 1 };
    } catch (err) {
      if (err?.code === 11000) {
        return claimSetupStart(businessId, options);
      }
      throw err;
    }
  }

  const state = existing.lockState;

  if (state === 'running') {
    if (!force) {
      throw new SetupStartError(
        'setup_in_progress',
        'A setup run is already in progress for this business.',
        { setupRunId: existing.activeSetupRunId?.toString() ?? null }
      );
    }
    if (!options.supersedeRunning) {
      throw new SetupStartError(
        'setup_in_progress',
        'A setup run is already in progress. Confirm cancellation of the prior run before forcing a new start.',
        {
          cancelPriorRunRequired: true,
          setupRunId: existing.activeSetupRunId?.toString() ?? null,
        }
      );
    }
    const priorSetupRunId = existing.activeSetupRunId?.toString() ?? null;
    const superseded = await BusinessSetupState.findOneAndUpdate(
      { businessId: bid, lockState: 'running' },
      {
        $set: {
          lockState: 'claiming',
          claimLeaseExpiresAt: leaseUntil,
          supersededAt: now,
        },
        $inc: { generation: 1 },
        $unset: { activeSetupRunId: '' },
      },
      { new: true }
    );
    if (!superseded) {
      return claimSetupStart(businessId, options);
    }
    return {
      generation: superseded.generation,
      superseded: true,
      priorSetupRunId,
    };
  }

  if (state === 'claiming') {
    const leaseExpired =
      !existing.claimLeaseExpiresAt || existing.claimLeaseExpiresAt <= now;
    if (!leaseExpired) {
      throw new SetupStartError(
        'setup_in_progress',
        'A setup run is already in progress for this business.',
        { setupRunId: existing.activeSetupRunId?.toString() ?? null }
      );
    }
    const reclaimed = await BusinessSetupState.findOneAndUpdate(
      {
        businessId: bid,
        lockState: 'claiming',
        claimLeaseExpiresAt: { $lte: now },
      },
      {
        $set: { lockState: 'claiming', claimLeaseExpiresAt: leaseUntil },
        $inc: { generation: 1 },
        $unset: { activeSetupRunId: '' },
      },
      { new: true }
    );
    if (!reclaimed) {
      return claimSetupStart(businessId, options);
    }
    return { generation: reclaimed.generation };
  }

  if (state === 'succeeded') {
    if (!force) {
      throw new SetupStartError(
        'setup_already_complete',
        'Setup already completed for this business. View the setup report or start a new run with force after confirming you understand the risks.',
        { setupRunId: existing.activeSetupRunId?.toString() ?? null }
      );
    }
    const superseded = await BusinessSetupState.findOneAndUpdate(
      { businessId: bid, lockState: 'succeeded' },
      {
        $set: {
          lockState: 'claiming',
          claimLeaseExpiresAt: leaseUntil,
          supersededAt: now,
        },
        $inc: { generation: 1 },
        $unset: { activeSetupRunId: '' },
      },
      { new: true }
    );
    if (!superseded) {
      return claimSetupStart(businessId, options);
    }
    return {
      generation: superseded.generation,
      superseded: true,
      priorSetupRunId: existing.activeSetupRunId?.toString(),
    };
  }

  const claimed = await BusinessSetupState.findOneAndUpdate(
    { businessId: bid, lockState: { $in: ['idle', 'failed'] } },
    {
      $set: { lockState: 'claiming', claimLeaseExpiresAt: leaseUntil },
      $inc: { generation: 1 },
      $unset: { activeSetupRunId: '' },
    },
    { new: true }
  );
  if (!claimed) {
    return claimSetupStart(businessId, options);
  }
  return { generation: claimed.generation };
}

/**
 * Mark setup as running after Temporal workflow start succeeds.
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {import('mongoose').Types.ObjectId | string} setupRunId
 */
async function confirmSetupRunning(businessId, setupRunId) {
  const bid = toBusinessObjectId(businessId);
  const sid = toBusinessObjectId(setupRunId);
  const updated = await BusinessSetupState.findOneAndUpdate(
    { businessId: bid, lockState: 'claiming' },
    {
      $set: {
        lockState: 'running',
        activeSetupRunId: sid,
      },
      $unset: { claimLeaseExpiresAt: '' },
    },
    { new: true }
  );
  if (!updated) {
    throw new Error('confirmSetupRunning: business lock is not in claiming state');
  }
}

/**
 * Release a failed claim when Temporal workflow start fails.
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
async function releaseFailedSetupClaim(businessId) {
  const bid = toBusinessObjectId(businessId);
  await BusinessSetupState.findOneAndUpdate(
    { businessId: bid, lockState: 'claiming' },
    {
      $set: { lockState: 'failed' },
      $unset: { activeSetupRunId: '', claimLeaseExpiresAt: '' },
    }
  );
}

/**
 * Sync lock from terminal SetupRun.status (called from activity lifecycle).
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {import('mongoose').Types.ObjectId | string} setupRunId
 * @param {string} setupRunStatus
 */
async function syncBusinessSetupLockFromStatus(businessId, setupRunId, setupRunStatus) {
  if (!isTerminalSetupRunStatus(setupRunStatus)) return;

  const bid = toBusinessObjectId(businessId);
  const sid = toBusinessObjectId(setupRunId);
  const lockState = setupRunStatus === 'SUCCEEDED' ? 'succeeded' : 'failed';

  await BusinessSetupState.findOneAndUpdate(
    {
      businessId: bid,
      activeSetupRunId: sid,
      lockState: 'running',
    },
    {
      $set: { lockState },
      $unset: { claimLeaseExpiresAt: '' },
    }
  );
}

/**
 * Current-run guard — call immediately before any provider mutation.
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {import('mongoose').Types.ObjectId | string} setupRunId
 */
async function assertCurrentSetupRun(businessId, setupRunId) {
  const bid = toBusinessObjectId(businessId);
  const sid = toBusinessObjectId(setupRunId).toString();
  const state = await BusinessSetupState.findOne({ businessId: bid }).lean();
  if (!state || state.activeSetupRunId?.toString() !== sid) {
    throw new SetupRunSupersededError();
  }
  if (state.lockState !== 'running') {
    throw new SetupRunSupersededError();
  }
}

module.exports = {
  SetupStartError,
  SetupRunSupersededError,
  isTerminalSetupRunStatus,
  ensureBusinessSetupStateSynced,
  claimSetupStart,
  confirmSetupRunning,
  releaseFailedSetupClaim,
  syncBusinessSetupLockFromStatus,
  assertCurrentSetupRun,
};
