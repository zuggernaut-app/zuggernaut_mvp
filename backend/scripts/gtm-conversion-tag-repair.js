'use strict';

/**
 * Gated repair/backfill for wrong GTM awct conversion tags.
 * Always runs inventory first. Default mode is dry-run; live repair requires --approve.
 *
 * Usage:
 *   node backend/scripts/gtm-conversion-tag-repair.js
 *   node backend/scripts/gtm-conversion-tag-repair.js --approve
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { spawnSync } = require('child_process');
const path = require('path');
require('../models');
const { createLogger } = require('../lib/observability/logger');
const { repairAffectedGtmConversionTags } = require('../services/capabilities/gtmConversionTagRepairService');

const approve = process.argv.includes('--approve');
const logger = createLogger({ name: 'gtmConversionTagRepair' });

if (process.env.NODE_ENV === 'production' && approve) {
  console.error('Refusing to run live GTM conversion tag repair in production without a controlled rollout.');
  process.exit(1);
}

const inventoryScript = path.join(__dirname, 'gtm-conversion-tag-inventory.js');
const inventory = spawnSync(process.execPath, [inventoryScript], { encoding: 'utf8' });

let summary;
try {
  summary = JSON.parse(inventory.stdout);
} catch {
  console.error('Inventory scan failed to produce JSON output.');
  console.error(inventory.stdout);
  console.error(inventory.stderr);
  process.exit(1);
}

if (summary.provenClean) {
  console.log('Inventory scan proves zero affected GTM conversion tags. Repair is a no-op.');
  process.exit(0);
}

if (summary.affected === 0) {
  console.error(
    'Inventory scan did not prove all published GTM containers were scanned cleanly. Repair cannot proceed until inventory is conclusive.'
  );
  process.exit(1);
}

const plan = {
  mode: approve ? 'approved_repair' : 'dry_run',
  affectedCount: summary.affected,
  steps: [
    'Create a new GTM workspace version with corrected awct conversionId/conversionLabel variables.',
    'Publish the new version after operator/customer approval.',
    'Keep prior container version for rollback.',
  ],
  affectedArtifacts: summary.affectedArtifacts,
};

console.log(JSON.stringify(plan, null, 2));

if (!approve) {
  console.error('Dry run only. Re-run with --approve after explicit operator/customer approval.');
  process.exit(0);
}

async function runApprovedRepair() {
  const uri = process.env.MONGODB_URI || process.env.mongodb_uri;
  if (!uri) {
    throw new Error('MONGODB_URI is required');
  }

  await mongoose.connect(uri);

  const repairResult = await repairAffectedGtmConversionTags({
    affectedArtifacts: summary.affectedArtifacts,
    logger,
  });

  console.log(
    JSON.stringify(
      {
        mode: 'approved_repair',
        affectedCount: summary.affected,
        ...repairResult,
      },
      null,
      2
    )
  );

  await mongoose.disconnect();
  process.exit(repairResult.errors.length > 0 ? 1 : 0);
}

runApprovedRepair().catch((err) => {
  console.error(err);
  process.exit(1);
});
