/**
 * Stage-by-stage trace of Dev Integrations OAuth flows (google_ads, gtm, gbp).
 *
 * Uses the same service functions as the frontend API routes to show where failures occur:
 *   1. Frontend connect URL (GET /dev/integrations/google/:provider/connect-url)
 *   2. OAuth callback parsing (GET /api/v1/integrations/google/callback — state only)
 *   3. Post-OAuth Mongo persistence (what completeGoogleOAuthCallback writes)
 *   4. Smoke test (POST /dev/integrations/:provider/smoke-test)
 *   5. Overview (GET /dev/integrations/overview)
 *   6. Temporal boundary (OAuth/smoke do NOT start workflows; setup-runs does)
 *
 * Usage:
 *   node scripts/traceDevIntegrationsFlow.js <businessId>
 *   node scripts/traceDevIntegrationsFlow.js <businessId> --provider gtm
 *   node scripts/traceDevIntegrationsFlow.js <businessId> --provider gbp --probe-callback-route
 *   node scripts/traceDevIntegrationsFlow.js <businessId> --oauth-outcome error --oauth-reason OAUTH_TOKEN_EXCHANGE_FAILED
 *   node scripts/traceDevIntegrationsFlow.js <businessId> --oauth-code <one-time-code>
 *   node scripts/traceDevIntegrationsFlow.js <businessId> --provider gtm --creation-diagnostics
 *   node scripts/traceDevIntegrationsFlow.js <businessId> --provider google_ads --creation-diagnostics --mode create_paused
 *
 * After OAuth, the browser URL includes integration/provider/reason — pass those to diagnose
 * whether completeGoogleOAuthCallback was called vs blocked earlier.
 *
 * Copy businessId from the Dev Integrations page (Sandbox section).
 */
'use strict';

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const { mongoose } = require('../shared');
require('../models');
const {
  runDevIntegrationsFlowTrace,
  formatTraceReport,
  TRACEABLE_PROVIDERS,
} = require('../lib/dev/devIntegrationsFlowTrace');
const {
  runCreationDiagnosticsFlowTrace,
  formatCreationDiagnosticsTraceReport,
  CREATION_DIAGNOSTIC_TRACE_PROVIDERS,
} = require('../lib/dev/creationDiagnosticsFlowTrace');

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
  let creationDiagnostics = false;
  let mode = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--provider' && args[i + 1]) provider = args[++i];
    else if (a === '--creation-diagnostics') creationDiagnostics = true;
    else if (a === '--mode' && args[i + 1]) mode = args[++i];
    else if (a === '--probe-temporal') probeTemporal = true;
    else if (a === '--probe-callback-route') probeCallbackRoute = true;
    else if (a === '--ensure-sandbox') ensureSandbox = true;
    else if (a === '--json') json = true;
    else if (a === '--oauth-outcome' && args[i + 1]) oauthOutcome = args[++i];
    else if (a === '--oauth-reason' && args[i + 1]) oauthReason = args[++i];
    else if (a === '--oauth-code' && args[i + 1]) oauthCode = args[++i];
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
    creationDiagnostics,
    mode,
  };
}

function usage() {
  console.error('Usage: node scripts/traceDevIntegrationsFlow.js <businessId> [options]');
  console.error(`Providers: ${TRACEABLE_PROVIDERS.join(', ')} (default: google_ads)`);
  console.error('Options:');
  console.error('  --provider <name>      google_ads | gtm | gbp');
  console.error('  --probe-temporal       Ping Temporal server (workflow.start only on setup-runs/scrape)');
  console.error('  --probe-callback-route HTTP GET callback route (backend reachable?)');
  console.error('  --oauth-outcome <v>    connected | error (from /dev/integrations URL after OAuth)');
  console.error('  --oauth-reason <v>     reason query param from same URL');
  console.error('  --oauth-code <v>       One-time code from Google redirect (replays completeGoogleOAuthCallback)');
  console.error('  --ensure-sandbox       Call ensureSandboxBusiness for --user-id');
  console.error('  --user-id <id>         User ObjectId (required with --ensure-sandbox if no businessId)');
  console.error('  --json                 Print full report as JSON after human summary');
  console.error('  --creation-diagnostics Run V1 creation diagnostic matrix (google_ads | gtm only)');
  console.error('  --mode <mode>          validate_only | create_paused | create_and_publish (GTM publish only)');
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

  await mongoose.connect(uri);

  try {
    if (opts.creationDiagnostics) {
      if (!opts.businessId) {
        console.error('--creation-diagnostics requires <businessId>');
        usage();
      }
      if (!CREATION_DIAGNOSTIC_TRACE_PROVIDERS.includes(opts.provider)) {
        console.error(
          `--creation-diagnostics requires --provider ${CREATION_DIAGNOSTIC_TRACE_PROVIDERS.join(' or ')} (not gbp).`
        );
        process.exit(1);
      }

      const report = await runCreationDiagnosticsFlowTrace({
        businessId: opts.businessId,
        provider: opts.provider,
        mode: opts.mode ?? undefined,
      });

      console.log(formatCreationDiagnosticsTraceReport(report));

      if (opts.json) {
        console.log('\n--- JSON ---');
        console.log(JSON.stringify(report, null, 2));
      }

      const failed = report.stages.some((s) => !s.ok && !s.skipped);
      process.exit(failed ? 1 : 0);
      return;
    }

    const report = await runDevIntegrationsFlowTrace({
      provider: opts.provider,
      businessId: opts.businessId ?? undefined,
      userId: opts.userId ?? undefined,
      probeTemporal: opts.probeTemporal,
      probeCallbackRoute: opts.probeCallbackRoute,
      ensureSandbox: opts.ensureSandbox,
      oauthOutcome: opts.oauthOutcome ?? undefined,
      oauthReason: opts.oauthReason ?? undefined,
      oauthCode: opts.oauthCode ?? undefined,
    });

    console.log(formatTraceReport(report));

    if (opts.json) {
      console.log('\n--- JSON ---');
      console.log(
        JSON.stringify(
          {
            provider: report.provider,
            businessId: report.businessId,
            userId: report.userId,
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
