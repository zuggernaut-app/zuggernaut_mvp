/**
 * Create a Google Ads test client account under the configured MCC.
 *
 * Uses OAuth tokens from Mongo (businessId) and GOOGLE_ADS_LOGIN_CUSTOMER_ID as manager.
 * The test_account flag is set at creation time — required for test developer tokens.
 *
 * Usage:
 *   node scripts/debugGoogleAdsCreateTestAccount.js <businessId>
 *   node scripts/debugGoogleAdsCreateTestAccount.js <businessId> --name "Zuggernaut Dev Test"
 *
 * After success, set in backend/.env:
 *   GOOGLE_ADS_PREFERRED_TEST_CUSTOMER_ID=<newCustomerId>
 */
'use strict';

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const { mongoose } = require('../shared');
require('../models');
const { getFreshGoogleAccessToken } = require('../services/integrations/googleTokenService');
const {
  createCustomerClient,
  listAccessibleCustomers,
  searchGoogleAdsCustomerMetadata,
} = require('../services/integrations/googleAdsAccountClient');
const {
  getGoogleAdsLoginCustomerId,
  normalizeCustomerId,
} = require('../services/integrations/googleAdsApiConfig');

const uri =
  process.env.MONGODB_URI ||
  process.env.mongodb_uri ||
  'mongodb://localhost:27017/zuggernaut';

function resolveManagerCustomerId(override) {
  const fromArg = normalizeCustomerId(override);
  if (fromArg) return fromArg;

  const testManager = normalizeCustomerId(process.env.GOOGLE_ADS_TEST_MANAGER_CUSTOMER_ID);
  if (testManager) return testManager;

  return getGoogleAdsLoginCustomerId({ required: true });
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let businessId = null;
  let name = 'Zuggernaut Dev Test Client';
  let managerId = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--name' && args[i + 1]) {
      name = args[++i];
    } else if (a === '--manager-id' && args[i + 1]) {
      managerId = args[++i];
    } else if (a === '--help' || a === '-h') {
      return { help: true };
    } else if (!a.startsWith('--') && !businessId && mongoose.Types.ObjectId.isValid(a)) {
      businessId = a;
    }
  }

  return { businessId, name, managerId };
}

function printHelp() {
  console.log(`Create a Google Ads test client under a TEST manager account.

Google test and production accounts cannot share a hierarchy. A test developer
token cannot create clients under production MCC ${process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? '346-219-8684'}.

Before running this script:
  1. Create a test manager: https://ads.google.com/aw/test-account
  2. In that test manager UI: Accounts → + → Create new account (auto test client)
     OR set GOOGLE_ADS_TEST_MANAGER_CUSTOMER_ID to the test manager ID and run this script.

Usage:
  npm run debug:google-ads-create-test-account -- <businessId>
  npm run debug:google-ads-create-test-account -- <businessId> --manager-id <testManagerId>
  npm run debug:google-ads-create-test-account -- <businessId> --name "My Test Client"

Env:
  GOOGLE_ADS_TEST_MANAGER_CUSTOMER_ID  test manager (preferred over GOOGLE_ADS_LOGIN_CUSTOMER_ID)
  GOOGLE_ADS_LOGIN_CUSTOMER_ID         production MCC — not valid for test account creation
`);
}

function formatCustomerId(customerId) {
  const digits = normalizeCustomerId(customerId);
  if (!digits || digits.length !== 10) return digits;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

async function main() {
  const parsed = parseArgs(process.argv);
  if (parsed.help) {
    printHelp();
    return;
  }

  const { businessId, name, managerId: managerIdArg } = parsed;

  if (!businessId) {
    printHelp();
    process.exit(1);
  }

  const managerCustomerId = resolveManagerCustomerId(managerIdArg);
  const productionMcc = normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
  const usingProductionMcc =
    productionMcc && managerCustomerId === productionMcc && !process.env.GOOGLE_ADS_TEST_MANAGER_CUSTOMER_ID;

  console.log('Google Ads create test client account');
  console.log('  businessId:', businessId);
  console.log('  manager (createCustomerClient target):', formatCustomerId(managerCustomerId));
  if (usingProductionMcc) {
    console.log('');
    console.warn(
      '  WARNING: Using production MCC as manager. Test developer tokens usually cannot create',
    );
    console.warn(
      '  clients under production accounts. Create a test manager at https://ads.google.com/aw/test-account',
    );
    console.warn('  then set GOOGLE_ADS_TEST_MANAGER_CUSTOMER_ID or pass --manager-id.');
  }
  console.log('  descriptiveName:', name);
  console.log('  testAccount: true');
  console.log('');

  await mongoose.connect(uri);

  try {
    const accessToken = await getFreshGoogleAccessToken({ businessId, provider: 'google_ads' });

    const created = await createCustomerClient(accessToken, managerCustomerId, {
      descriptiveName: name,
      currencyCode: process.env.GOOGLE_ADS_DEFAULT_CURRENCY_CODE?.trim() || 'USD',
      timeZone: process.env.GOOGLE_ADS_DEFAULT_TIME_ZONE?.trim() || 'Asia/Kolkata',
      testAccount: true,
    });

    console.log('Created customer client:');
    console.log('  customerId:', created.customerId);
    console.log('  formatted:', formatCustomerId(created.customerId));
    console.log('  resourceName:', created.resourceName);
    console.log('');

    const metadata = await searchGoogleAdsCustomerMetadata(accessToken, created.customerId);
    console.log('Metadata check:');
    console.log('  descriptiveName:', metadata?.descriptiveName ?? '(unknown)');
    console.log('  testAccount:', metadata?.testAccount === true ? 'yes' : metadata?.testAccount === false ? 'no' : '(unknown)');
    console.log('  status:', metadata?.status ?? '(unknown)');
    if (metadata?.metadataError) {
      console.log('  metadataError:', metadata.authorizationError ?? 'yes');
    }
    console.log('');

    const accessible = await listAccessibleCustomers(accessToken);
    const listed = accessible.includes(created.customerId);
    console.log('listAccessibleCustomers includes new account:', listed ? 'yes' : 'no');
    console.log('  accessible count:', accessible.length);
    console.log('');

    console.log('Next steps:');
    console.log(`  1. Add to backend/.env: GOOGLE_ADS_PREFERRED_TEST_CUSTOMER_ID=${created.customerId}`);
    console.log('  2. In Dev Integrations, run Smoke test, then Save Google Ads selection for this account.');
    console.log(`  3. Verify: npm run debug:dev-integrations-flow -- ${businessId}`);
  } catch (err) {
    console.error('Failed to create test account.');
    console.error(err instanceof Error ? err.message : err);
    if (err.details) {
      console.error('Details:', JSON.stringify(err.details, null, 2));
    }
    const authErr =
      err.details?.googleStatus === 'PERMISSION_DENIED' ||
      String(err.message ?? '').includes('permission');
    if (authErr || err.code === 'ADS_MCC_PERMISSION_DENIED') {
      console.error('');
      console.error('Likely cause: manager account is production, not a test manager.');
      console.error('Fix:');
      console.error('  1. Open https://ads.google.com/aw/test-account and create a TEST manager account.');
      console.error('  2. Copy its customer ID into backend/.env:');
      console.error('       GOOGLE_ADS_TEST_MANAGER_CUSTOMER_ID=<test_manager_id>');
      console.error('  3. Re-run this script, or create a client in the test manager UI (Accounts → +).');
      console.error('  4. OAuth in Dev Integrations with a user that has access to the test hierarchy.');
    }
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
