'use strict';

/**
 * Temporal activity policies for setupRunWorkflow.
 * Precondition checks retry less; provider mutations retry with idempotent guards.
 * Validation/precondition failures in activities must throw ApplicationFailure.nonRetryable().
 */
const SETUP_ACTIVITY_POLICIES = Object.freeze({
  control: {
    startToCloseTimeout: '2 minutes',
    scheduleToCloseTimeout: '5 minutes',
    retry: {
      maximumAttempts: 3,
      initialInterval: '1s',
      backoffCoefficient: 2,
      maximumInterval: '20s',
    },
  },
  precondition: {
    startToCloseTimeout: '1 minute',
    scheduleToCloseTimeout: '3 minutes',
    retry: {
      maximumAttempts: 2,
      initialInterval: '1s',
      backoffCoefficient: 2,
      maximumInterval: '10s',
    },
  },
  read: {
    startToCloseTimeout: '5 minutes',
    scheduleToCloseTimeout: '12 minutes',
    retry: {
      maximumAttempts: 4,
      initialInterval: '2s',
      backoffCoefficient: 2,
      maximumInterval: '45s',
    },
  },
  mutate: {
    startToCloseTimeout: '10 minutes',
    scheduleToCloseTimeout: '20 minutes',
    retry: {
      maximumAttempts: 3,
      initialInterval: '3s',
      backoffCoefficient: 2,
      maximumInterval: '90s',
    },
  },
});

module.exports = { SETUP_ACTIVITY_POLICIES };
