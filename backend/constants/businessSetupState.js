'use strict';

/** Per-business setup start lock — one active/succeeded guard for POST /setup-runs. */
const BUSINESS_SETUP_LOCK_STATE = Object.freeze([
  'idle',
  'claiming',
  'running',
  'succeeded',
  'failed',
]);

/** SetupRun.status values that release the business lock (workflow ended or paused for user action). */
const SETUP_RUN_TERMINAL_LOCK_STATUSES = Object.freeze([
  'SUCCEEDED',
  'FAILED',
  'SETUP_NEEDS_MANUAL_REVIEW',
  'SETUP_NEEDS_TRACKING_FIX',
  'GTM_SNIPPET_PENDING',
  'GTM_PROVISIONING_REQUIRED',
  'ADS_PROVISIONING_REQUIRED',
]);

/** Milliseconds a `claiming` lease is valid before another start may reclaim. */
const SETUP_CLAIM_LEASE_MS = 2 * 60 * 1000;

module.exports = {
  BUSINESS_SETUP_LOCK_STATE,
  SETUP_RUN_TERMINAL_LOCK_STATUSES,
  SETUP_CLAIM_LEASE_MS,
};
