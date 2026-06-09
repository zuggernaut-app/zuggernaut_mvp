'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { verifyRealModeEnvironment } = require('../lib/verifyRealModeEnvironment');
const { resolveTemporalTaskQueue } = require('../constants/temporalDefaults');

const result = verifyRealModeEnvironment();

for (const warning of result.warnings) {
  // eslint-disable-next-line no-console
  console.warn(`WARN: ${warning}`);
}

if (!result.ok) {
  for (const err of result.errors) {
    // eslint-disable-next-line no-console
    console.error(`ERROR: ${err}`);
  }
  // eslint-disable-next-line no-console
  console.error(
    '\nReal-mode preflight failed. See backend/.env.example mode matrix and backend/tests/REAL_MODE_E2E_CHECKLIST.md'
  );
  process.exit(1);
}

// eslint-disable-next-line no-console
console.warn(
  JSON.stringify({
    msg: 'Real-mode environment preflight passed',
    taskQueue: resolveTemporalTaskQueue(),
    hint: 'Start Temporal worker, then run backend/tests/REAL_MODE_E2E_CHECKLIST.md',
  })
);
