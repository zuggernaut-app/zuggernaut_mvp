/**
 * Google Ads OAuth lab — focused OAuth trace and optional read/write tests.
 *
 * Usage:
 *   node scripts/traceGoogleAdsOAuthLab.js <businessId>
 *   node scripts/traceGoogleAdsOAuthLab.js <businessId> --read-write
 *   node scripts/traceGoogleAdsOAuthLab.js <businessId> --read-write --customer-id 5369183891
 *   node scripts/traceGoogleAdsOAuthLab.js <businessId> --read-write --include-campaign
 *   node scripts/traceGoogleAdsOAuthLab.js <businessId> --json
 *
 * OAuth is stored per businessId in Mongo IntegrationConnection.
 * The Google account you sign in with during Connect (OAuth) is what matters for Ads API permissions.
 */
'use strict';

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const mongoose = require('mongoose');
require('../models');
const {
  runOAuthTrace,
  runReadWriteTests,
  formatOAuthTraceReport,
  formatReadWriteReport,
} = require('../lib/dev/googleAdsOAuthLab');

const uri =
  process.env.MONGODB_URI ||
  process.env.mongodb_uri ||
  'mongodb://localhost:27017/zuggernaut';

function parseArgs(argv) {
  const args = argv.slice(2);
  let businessId = null;
  let readWrite = false;
  let customerId = null;
  let includeCampaign = false;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--read-write') readWrite = true;
    else if (a === '--include-campaign') includeCampaign = true;
    else if (a === '--json') json = true;
    else if (a === '--customer-id' && args[i + 1]) customerId = args[++i];
    else if (!a.startsWith('--') && !businessId && mongoose.Types.ObjectId.isValid(a)) {
      businessId = a;
    }
  }

  return { businessId, readWrite, customerId, includeCampaign, json };
}

function usage() {
  console.error('Usage: node scripts/traceGoogleAdsOAuthLab.js <businessId> [options]');
  console.error('Options:');
  console.error('  --read-write           Run read/write API tests after OAuth trace');
  console.error('  --customer-id <id>     Target customer for read/write (no dashes)');
  console.error('  --include-campaign     Also run campaigns:mutate after budget write');
  console.error('  --json                 Print JSON after human summary');
  process.exit(1);
}

async function main() {
  const opts = parseArgs(process.argv);
  if (!opts.businessId) usage();

  await mongoose.connect(uri);

  try {
    const oauthReport = await runOAuthTrace(opts.businessId, null);
    console.log(formatOAuthTraceReport(oauthReport));

    if (opts.json) {
      console.log('\n--- OAuth trace JSON ---');
      console.log(JSON.stringify(oauthReport, null, 2));
    }

    let exitCode = oauthReport.stages.some((s) => !s.ok && !s.skipped) ? 1 : 0;

    if (opts.readWrite) {
      const rwReport = await runReadWriteTests(opts.businessId, {
        customerId: opts.customerId ?? undefined,
        includeCampaign: opts.includeCampaign,
      });
      console.log('\n' + formatReadWriteReport(rwReport));

      if (opts.json) {
        console.log('\n--- Read/write JSON ---');
        console.log(JSON.stringify(rwReport, null, 2));
      }

      if (rwReport.stages.some((s) => !s.ok && !s.skipped)) {
        exitCode = 1;
      }
    }

    process.exit(exitCode);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
