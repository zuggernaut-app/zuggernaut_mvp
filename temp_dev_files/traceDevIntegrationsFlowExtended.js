/**
 * Extended Dev Integrations flow trace — original stages plus Google Ads read/write checks.
 *
 * The original script (traceDevIntegrationsFlow.js) is unchanged. This duplicate runs the
 * same OAuth/smoke/overview pipeline, then adds isolated Google Ads API validations:
 *   - Read: customer metadata, user access, MCC client link
 *   - Write: campaign budget, conversion action, optional paused search campaign
 *
 * Usage:
 *   node scripts/traceDevIntegrationsFlowExtended.js <businessId>
 *   node scripts/traceDevIntegrationsFlowExtended.js <businessId> --skip-writes
 *   node scripts/traceDevIntegrationsFlowExtended.js <businessId> --include-campaign
 *   node scripts/traceDevIntegrationsFlowExtended.js <businessId> --customer-id 7809414862
 *
 * Copy businessId from the Dev Integrations page (Sandbox section).
 */
'use strict';

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const mongoose = require('mongoose');
require('../models');
const {
  runDevIntegrationsFlowTraceExtended,
  formatExtendedTraceReport,
  TRACEABLE_PROVIDERS,
} = require('../lib/dev/devIntegrationsFlowTraceExtended');

const uri =
  process.env.MONGODB_URI ||
  process.env.mongodb_uri ||
  'mongodb://localhost:27017/zuggernaut';

function parseArgs(argv) {
  const args = argv.slice(2);
  let businessId = null;
  let userId = null;
  let probeTemporal = false;
  let probeCallbackRoute = false;
  let ensureSandbox = false;
  let json = false;
  let oauthOutcome = null;
  let oauthReason = null;
  let oauthCode = null;
  let provider = 'google_ads';
  let customerId = null;
  let skipReads = false;
  let skipWrites = false;
  let includeCampaign = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--provider' && args[i + 1]) provider = args[++i];
    else if (a === '--probe-temporal') probeTemporal = true;
    else if (a === '--probe-callback-route') probeCallbackRoute = true;
    else if (a === '--ensure-sandbox') ensureSandbox = true;
    else if (a === '--json') json = true;
    else if (a === '--oauth-outcome' && args[i + 1]) oauthOutcome = args[++i];
    else if (a === '--oauth-reason' && args[i + 1]) oauthReason = args[++i];
    else if (a === '--oauth-code' && args[i + 1]) oauthCode = args[++i];
    else if (a === '--customer-id' && args[i + 1]) customerId = args[++i];
    else if (a === '--skip-reads') skipReads = true;
    else if (a === '--skip-writes') skipWrites = true;
    else if (a === '--include-campaign') includeCampaign = true;
    else if (a === '--user-id' && args[i + 1]) {
      userId = args[++i];
    } else if (!a.startsWith('--') && !businessId && mongoose.Types.ObjectId.isValid(a)) {
      businessId = a;
    }
  }

  return {
    businessId,
    userId,
    probeTemporal,
    probeCallbackRoute,
    ensureSandbox,
    json,
    oauthOutcome,
    oauthReason,
    oauthCode,
    provider,
    customerId,
    skipReads,
    skipWrites,
    includeCampaign,
  };
}

function usage() {
  console.error('Usage: node scripts/traceDevIntegrationsFlowExtended.js <businessId> [options]');
  console.error(`Providers: ${TRACEABLE_PROVIDERS.join(', ')} (default: google_ads)`);
  console.error('Options (same as traceDevIntegrationsFlow.js):');
  console.error('  --provider <name>           google_ads | gtm | gbp');
  console.error('  --probe-temporal            Ping Temporal server');
  console.error('  --probe-callback-route      HTTP GET callback route');
  console.error('  --oauth-outcome <v>         connected | error');
  console.error('  --oauth-reason <v>          reason query param from OAuth redirect');
  console.error('  --oauth-code <v>            One-time code from Google redirect');
  console.error('  --ensure-sandbox            Call ensureSandboxBusiness for --user-id');
  console.error('  --user-id <id>              User ObjectId');
  console.error('  --json                      Print full report as JSON');
  console.error('Extended Google Ads options:');
  console.error('  --customer-id <id>          Override selected customer');
  console.error('  --skip-reads                Skip read validation steps');
  console.error('  --skip-writes               Skip mutate steps (reads only)');
  console.error('  --include-campaign          Create paused search campaign when budget succeeds');
  process.exit(1);
}

async function main() {
  const opts = parseArgs(process.argv);

  if (!opts.businessId && !opts.ensureSandbox) {
    usage();
  }
  if (opts.ensureSandbox && !opts.userId) {
    console.error('--ensure-sandbox requires --user-id');
    usage();
  }

  if (process.env.GOOGLE_ADS_API_MOCK === 'true') {
    console.warn('Warning: GOOGLE_ADS_API_MOCK=true — extended trace forces real Google Ads API.');
    process.env.GOOGLE_ADS_API_MOCK = 'false';
  }

  await mongoose.connect(uri);

  try {
    const report = await runDevIntegrationsFlowTraceExtended({
      provider: opts.provider,
      businessId: opts.businessId ?? undefined,
      userId: opts.userId ?? undefined,
      probeTemporal: opts.probeTemporal,
      probeCallbackRoute: opts.probeCallbackRoute,
      ensureSandbox: opts.ensureSandbox,
      oauthOutcome: opts.oauthOutcome ?? undefined,
      oauthReason: opts.oauthReason ?? undefined,
      oauthCode: opts.oauthCode ?? undefined,
      customerId: opts.customerId ?? undefined,
      skipReads: opts.skipReads,
      skipWrites: opts.skipWrites,
      includeCampaign: opts.includeCampaign,
    });

    console.log(formatExtendedTraceReport(report));

    if (opts.json) {
      console.log('\n--- JSON ---');
      console.log(
        JSON.stringify(
          {
            provider: report.provider,
            businessId: report.businessId,
            userId: report.userId,
            extended: report.extended,
            firstFailure: report.firstFailure,
            stages: report.stages,
          },
          null,
          2,
        ),
      );
    }

    const failed = report.stages.some((s) => !s.ok && !s.skipped);
    process.exit(failed ? 1 : 0);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
