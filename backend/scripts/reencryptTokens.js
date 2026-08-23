'use strict';

/**
 * Idempotent re-encrypt IntegrationConnection tokens to enc:v1 format.
 * Run during a maintenance window with the Temporal worker stopped.
 *
 * Usage:
 *   node backend/scripts/reencryptTokens.js --dry-run
 *   node backend/scripts/reencryptTokens.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
require('../models');
const { createLogger } = require('../lib/observability/logger');
const {
  decryptToken,
  encryptToken,
  isV1Encrypted,
} = require('../lib/crypto/tokenEncryption');

const dryRun = process.argv.includes('--dry-run');
const logger = createLogger({ name: 'reencryptTokens' });
const IntegrationConnection = mongoose.model('IntegrationConnection');

const TOKEN_FIELDS = ['accessTokenEnc', 'refreshTokenEnc'];

/**
 * @param {import('mongoose').Document} row
 * @param {string} field
 */
async function reencryptField(row, field) {
  const current = row.get(field);
  if (!current || isV1Encrypted(current)) {
    return { field, status: 'skipped', reason: 'missing_or_v1' };
  }

  const plaintext = decryptToken(current);
  const next = encryptToken(plaintext);

  if (dryRun) {
    return { field, status: 'would_update', connectionId: row._id.toString() };
  }

  const filter = { _id: row._id, [field]: current };
  const updated = await IntegrationConnection.findOneAndUpdate(
    filter,
    { $set: { [field]: next } },
    { new: true }
  ).exec();

  if (!updated) {
    return {
      field,
      status: 'skipped',
      reason: 'conditional_mismatch',
      connectionId: row._id.toString(),
    };
  }

  return { field, status: 'updated', connectionId: row._id.toString() };
}

async function main() {
  const uri = process.env.MONGODB_URI || process.env.mongodb_uri;
  if (!uri) {
    throw new Error('MONGODB_URI is required');
  }

  await mongoose.connect(uri);

  const rows = await IntegrationConnection.find()
    .select('+accessTokenEnc +refreshTokenEnc businessId provider')
    .exec();

  const audit = {
    dryRun,
    scanned: rows.length,
    results: [],
  };

  for (const row of rows) {
    for (const field of TOKEN_FIELDS) {
      const result = await reencryptField(row, field);
      audit.results.push({
        businessId: row.businessId?.toString(),
        provider: row.provider,
        ...result,
      });
      logger.info({ businessId: row.businessId, provider: row.provider, ...result }, 'reencrypt.token');
    }
  }

  const updated = audit.results.filter((r) => r.status === 'updated' || r.status === 'would_update').length;
  const skipped = audit.results.filter((r) => r.status === 'skipped').length;
  audit.summary = { updated, skipped };

  console.log(JSON.stringify(audit, null, 2));

  await mongoose.disconnect();
}

main().catch((err) => {
  logger.error({ err }, 'reencrypt.failed');
  console.error(err);
  process.exit(1);
});
