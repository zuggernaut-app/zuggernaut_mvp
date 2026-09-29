'use strict';

/**
 * One-off: rename growth → middle, seed top plan row.
 * Does not invent stripePriceId values — must be set via env before enabling price-derived billing.
 *
 * Usage: node backend/scripts/migrate-plan-tiers.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Plan = require('../models/Plan');

async function main() {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is required');
  }
  await mongoose.connect(uri);

  const growth = await Plan.findOne({ tier: 'growth' });
  if (growth) {
    growth.tier = 'middle';
    if (!growth.name || growth.name.toLowerCase() === 'growth') {
      growth.name = 'Middle';
    }
    await growth.save();
    console.log('Renamed growth plan to middle');
  }

  const topStripePriceId = process.env.STRIPE_PRICE_ID_TOP?.trim() || null;
  const middleStripePriceId = process.env.STRIPE_PRICE_ID_MIDDLE?.trim() || growth?.stripePriceId || null;
  const starterStripePriceId = process.env.STRIPE_PRICE_ID_STARTER?.trim() || null;

  await Plan.findOneAndUpdate(
    { tier: 'starter' },
    {
      $setOnInsert: { name: 'Starter', active: true },
      ...(starterStripePriceId ? { $set: { stripePriceId: starterStripePriceId } } : {}),
    },
    { upsert: true, new: true }
  );

  await Plan.findOneAndUpdate(
    { tier: 'middle' },
    {
      $setOnInsert: { name: 'Middle', active: true },
      ...(middleStripePriceId ? { $set: { stripePriceId: middleStripePriceId } } : {}),
    },
    { upsert: true, new: true }
  );

  await Plan.findOneAndUpdate(
    { tier: 'top' },
    {
      $setOnInsert: { name: 'Top', active: true },
      ...(topStripePriceId ? { $set: { stripePriceId: topStripePriceId } } : {}),
    },
    { upsert: true, new: true }
  );

  const activePlans = await Plan.find({ active: true }).lean();
  const missingPrice = activePlans.filter((p) => !p.stripePriceId);
  if (missingPrice.length > 0) {
    console.warn(
      'WARNING: active plans missing stripePriceId:',
      missingPrice.map((p) => p.tier).join(', ')
    );
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
