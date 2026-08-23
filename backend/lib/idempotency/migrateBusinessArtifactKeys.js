'use strict';

const mongoose = require('mongoose');
const IntegrationArtifact = mongoose.model('IntegrationArtifact');
const BusinessContext = mongoose.model('BusinessContext');
const { computeBusinessIntentFingerprint } = require('./businessIntentFingerprint');
const {
  businessScopedIdempotencyKey,
  parseLegacyScopedIdempotencyKey,
} = require('../../constants/idempotency');

/**
 * One-time migration: attach business-scoped keys + intent fingerprint to legacy setupRun-scoped artifacts.
 */
async function migrateLegacyArtifactIdempotencyKeys() {
  const artifacts = await IntegrationArtifact.find({
    idempotencyKey: { $regex: /^(ads|gtm)-[a-f0-9]{24}-/ },
  }).lean();

  let migrated = 0;
  let skipped = 0;

  for (const artifact of artifacts) {
    const parsed = parseLegacyScopedIdempotencyKey(artifact.idempotencyKey);
    if (!parsed) {
      skipped += 1;
      continue;
    }

    const bc = await BusinessContext.findOne({ businessId: artifact.businessId }).lean();
    if (!bc) {
      skipped += 1;
      continue;
    }

    const intentFingerprint = computeBusinessIntentFingerprint(bc);
    const provider = parsed.prefix === 'ads' ? 'google_ads' : 'gtm';
    const bizKey = businessScopedIdempotencyKey(
      artifact.businessId,
      provider,
      parsed.logicalKey,
      intentFingerprint
    );

    const collision = await IntegrationArtifact.findOne({
      idempotencyKey: bizKey,
      _id: { $ne: artifact._id },
    })
      .select('_id')
      .lean();

    const metadata = {
      ...(artifact.metadata && typeof artifact.metadata === 'object' ? artifact.metadata : {}),
      logicalKey: parsed.logicalKey,
      intentFingerprint,
      legacyIdempotencyKey: artifact.idempotencyKey,
    };

    if (!collision) {
      await IntegrationArtifact.updateOne(
        { _id: artifact._id },
        {
          $set: {
            idempotencyKey: bizKey,
            metadata,
          },
        }
      );
      migrated += 1;
    } else {
      await IntegrationArtifact.updateOne(
        { _id: artifact._id },
        {
          $set: { metadata },
        }
      );
      skipped += 1;
    }
  }

  return { migrated, skipped, scanned: artifacts.length };
}

module.exports = {
  migrateLegacyArtifactIdempotencyKeys,
};
