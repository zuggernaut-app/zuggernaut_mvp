'use strict';

const { proxyActivities } = require('@temporalio/workflow');

const { pollAdsDisapprovalsActivity } = proxyActivities({
  startToCloseTimeout: '10 minutes',
  retry: { maximumAttempts: 3 },
});

/**
 * Task 41 — read-only disapproval polling with deduped operator notifications.
 */
async function disapprovalPollWorkflow() {
  return pollAdsDisapprovalsActivity();
}

module.exports = { disapprovalPollWorkflow };
