'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
require('../models');

const CampaignPlan = mongoose.model('CampaignPlan');

/**
 * @param {import('mongodb').Collection} collection
 * @param {Record<string, number>} keySpec
 */
function findIndexByKey(collection, keySpec) {
  return collection.indexes().then((indexes) =>
    indexes.find((idx) => {
      const expected = Object.entries(keySpec);
      const actual = Object.entries(idx.key);
      if (actual.length !== expected.length) return false;
      return expected.every(([field, direction]) => idx.key[field] === direction);
    })
  );
}

async function main() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/zuggernaut';
  await mongoose.connect(mongoUri);

  const collection = CampaignPlan.collection;

  const withoutSlot = await CampaignPlan.countDocuments({
    $or: [{ slot: { $exists: false } }, { slot: null }],
  });
  if (withoutSlot > 0) {
    const res = await CampaignPlan.updateMany(
      { $or: [{ slot: { $exists: false } }, { slot: null }] },
      { $set: { slot: 'recommended' } }
    );
    console.log(`Backfilled slot=recommended on ${res.modifiedCount} campaign plan(s).`);
  } else {
    console.log('No campaign plans need slot backfill.');
  }

  const legacyIndex = await findIndexByKey(collection, { setupRunId: 1 });
  if (legacyIndex) {
    await collection.dropIndex(legacyIndex.name);
    console.log(`Dropped legacy setupRunId-only index (${legacyIndex.name}).`);
  } else {
    console.log('Legacy setupRunId-only index already absent.');
  }

  const slotIndex = await findIndexByKey(collection, { setupRunId: 1, slot: 1 });
  if (!slotIndex?.unique) {
    await collection.createIndex({ setupRunId: 1, slot: 1 }, { unique: true });
    console.log('Ensured unique compound index { setupRunId: 1, slot: 1 }.');
  } else {
    console.log('Compound { setupRunId, slot } unique index already present.');
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
