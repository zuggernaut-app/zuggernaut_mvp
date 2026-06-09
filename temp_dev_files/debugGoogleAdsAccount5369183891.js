/**
 * Standalone diagnostic for Google Ads account 536-918-3891 (5369183891).
 *
 * Thin wrapper around debugGoogleAdsWriteCapabilities.js — isolated from Jest.
 *
 * Usage:
 *   node scripts/debugGoogleAdsAccount5369183891.js <businessId>
 *   npm run debug:google-ads-account-5369183891 -- <businessId>
 *
 * Example:
 *   npm run debug:google-ads-account-5369183891 -- 6a2572c4a20652b5c3119971
 */
'use strict';

const TARGET_CUSTOMER_ID = '5369183891';

const businessId = process.argv[2]?.trim();
if (!businessId) {
  console.error('Usage: node scripts/debugGoogleAdsAccount5369183891.js <businessId>');
  console.error(`Target account: ${TARGET_CUSTOMER_ID} (536-918-3891)`);
  process.exit(1);
}

console.log(`Running write-capabilities check for account 536-918-3891 (${TARGET_CUSTOMER_ID})`);
console.log(`Business: ${businessId}\n`);

process.argv = [process.argv[0], process.argv[1], businessId, TARGET_CUSTOMER_ID];
require('./debugGoogleAdsWriteCapabilities');
