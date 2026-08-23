'use strict';

/** Claim states for conversion-action creation idempotency. */
const CONVERSION_ACTION_CLAIM_STATES = Object.freeze([
  'claiming',
  'created',
  'failed',
]);

/** Milliseconds a `claiming` lease is valid before another worker may reclaim. */
const CONVERSION_ACTION_CLAIM_LEASE_MS = 45 * 1000;

module.exports = {
  CONVERSION_ACTION_CLAIM_STATES,
  CONVERSION_ACTION_CLAIM_LEASE_MS,
};
