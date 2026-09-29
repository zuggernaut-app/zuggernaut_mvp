'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Client, ScheduleClient } = require('@temporalio/client');
const { withRetry } = require('./temporal-connect-retry');
const { resolveTemporalConnectOptions } = require('../lib/temporalConnectionOptions');
const { resolveTemporalNamespace, resolveTemporalTaskQueue } = require('../constants/temporalDefaults');

async function main() {
  const connectOptions = resolveTemporalConnectOptions();
  const namespace = resolveTemporalNamespace();
  const taskQueue = resolveTemporalTaskQueue();

  const connection = await withRetry('Temporal schedule client', () =>
    require('@temporalio/client').Connection.connect(connectOptions)
  );

  const scheduleClient = new ScheduleClient({ connection, namespace });

  const schedules = [
    {
      scheduleId: 'lead-campaign-grace-pause',
      workflowType: 'gracePauseWorkflow',
      cron: '0 */6 * * *',
    },
    {
      scheduleId: 'lead-campaign-disapproval-poll',
      workflowType: 'disapprovalPollWorkflow',
      cron: '0 */2 * * *',
    },
  ];

  for (const spec of schedules) {
    try {
      await scheduleClient.create({
        scheduleId: spec.scheduleId,
        spec: { cronExpressions: [spec.cron] },
        action: {
          type: 'startWorkflow',
          workflowType: spec.workflowType,
          taskQueue,
          args: [],
        },
      });
      console.log(`Created schedule ${spec.scheduleId}`);
    } catch (err) {
      if (/already exists/i.test(String(err?.message))) {
        console.log(`Schedule ${spec.scheduleId} already exists.`);
      } else {
        throw err;
      }
    }
  }

  await connection.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
