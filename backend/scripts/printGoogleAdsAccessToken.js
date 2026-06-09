'use strict';

const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });
require('../models');

const mongoose = require('mongoose');
const { getFreshGoogleAccessToken } = require('../services/integrations/googleTokenService');

async function main() {
  const businessId = process.argv[2]?.trim();
  if (!businessId) {
    console.error('Usage: node scripts/printGoogleAdsAccessToken.js <businessId>');
    process.exit(1);
  }

  await mongoose.connect(
    process.env.MONGODB_URI || process.env.mongodb_uri || 'mongodb://localhost:27017/zuggernaut',
  );
  const token = await getFreshGoogleAccessToken({ businessId, provider: 'google_ads' });
  process.stdout.write(token);
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
