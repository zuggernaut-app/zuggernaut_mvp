'use strict';

const { proxyActivities } = require('@temporalio/workflow');

const { gracePauseExpiredSubscriptionsActivity } = proxyActivities({
  startToCloseTimeout: '10 minutes',
  retry: { maximumAttempts: 3 },
});

/**
 * Task 40a — pause campaigns when subscription grace expires; supersede pending enables.
 */
async function gracePauseWorkflow() {
  return gracePauseExpiredSubscriptionsActivity();
}

module.exports = { gracePauseWorkflow };
