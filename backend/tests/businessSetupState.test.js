'use strict';

const mongoose = require('mongoose');
const {
  claimSetupStart,
  confirmSetupRunning,
  releaseFailedSetupClaim,
  assertCurrentSetupRun,
  SetupStartError,
  SetupRunSupersededError,
} = require('../services/setup/businessSetupStateService');

describe('businessSetupStateService', () => {
  let businessId;

  beforeEach(() => {
    businessId = new mongoose.Types.ObjectId();
  });

  it('claims a new business and confirms running', async () => {
    const claim = await claimSetupStart(businessId);
    expect(claim.generation).toBe(1);

    const setupRunId = new mongoose.Types.ObjectId();
    await confirmSetupRunning(businessId, setupRunId);

    const BusinessSetupState = mongoose.model('BusinessSetupState');
    const state = await BusinessSetupState.findOne({ businessId }).lean();
    expect(state.lockState).toBe('running');
    expect(state.activeSetupRunId.toString()).toBe(setupRunId.toString());

    await assertCurrentSetupRun(businessId, setupRunId);
  });

  it('rejects concurrent claim while running', async () => {
    const setupRunId = new mongoose.Types.ObjectId();
    await claimSetupStart(businessId);
    await confirmSetupRunning(businessId, setupRunId);

    await expect(claimSetupStart(businessId)).rejects.toMatchObject({
      code: 'setup_in_progress',
    });
  });

  it('requires cancel confirmation before force while running', async () => {
    const setupRunId = new mongoose.Types.ObjectId();
    await claimSetupStart(businessId);
    await confirmSetupRunning(businessId, setupRunId);

    await expect(claimSetupStart(businessId, { force: true })).rejects.toMatchObject({
      code: 'setup_in_progress',
      details: { cancelPriorRunRequired: true },
    });
  });

  it('supersedes running lock when force and supersedeRunning are set', async () => {
    const priorRunId = new mongoose.Types.ObjectId();
    await claimSetupStart(businessId);
    await confirmSetupRunning(businessId, priorRunId);

    const claim = await claimSetupStart(businessId, { force: true, supersedeRunning: true });
    expect(claim.superseded).toBe(true);
    expect(claim.priorSetupRunId).toBe(priorRunId.toString());

    const BusinessSetupState = mongoose.model('BusinessSetupState');
    const state = await BusinessSetupState.findOne({ businessId }).lean();
    expect(state.lockState).toBe('claiming');
    expect(state.activeSetupRunId).toBeUndefined();
  });

  it('rejects start when succeeded without force', async () => {
    const BusinessSetupState = mongoose.model('BusinessSetupState');
    await BusinessSetupState.create({
      businessId,
      lockState: 'succeeded',
      generation: 1,
    });

    await expect(claimSetupStart(businessId)).rejects.toMatchObject({
      code: 'setup_already_complete',
    });
  });

  it('supersedes succeeded lock when force=true', async () => {
    const priorRunId = new mongoose.Types.ObjectId();
    const BusinessSetupState = mongoose.model('BusinessSetupState');
    await BusinessSetupState.create({
      businessId,
      lockState: 'succeeded',
      activeSetupRunId: priorRunId,
      generation: 2,
    });

    const claim = await claimSetupStart(businessId, { force: true });
    expect(claim.superseded).toBe(true);
    expect(claim.priorSetupRunId).toBe(priorRunId.toString());
    expect(claim.generation).toBe(3);

    const state = await BusinessSetupState.findOne({ businessId }).lean();
    expect(state.lockState).toBe('claiming');
  });

  it('releases failed claim after temporal start failure', async () => {
    await claimSetupStart(businessId);
    await releaseFailedSetupClaim(businessId);

    const BusinessSetupState = mongoose.model('BusinessSetupState');
    const state = await BusinessSetupState.findOne({ businessId }).lean();
    expect(state.lockState).toBe('failed');

    const reclaim = await claimSetupStart(businessId);
    expect(reclaim.generation).toBeGreaterThan(1);
  });

  it('assertCurrentSetupRun rejects superseded run', async () => {
    const activeRunId = new mongoose.Types.ObjectId();
    const staleRunId = new mongoose.Types.ObjectId();
    const BusinessSetupState = mongoose.model('BusinessSetupState');
    await BusinessSetupState.create({
      businessId,
      lockState: 'running',
      activeSetupRunId: activeRunId,
      generation: 1,
    });

    await expect(assertCurrentSetupRun(businessId, staleRunId)).rejects.toBeInstanceOf(
      SetupRunSupersededError
    );
  });
});
