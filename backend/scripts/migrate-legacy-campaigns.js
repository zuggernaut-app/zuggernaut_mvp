'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
require('../models');

const IntegrationArtifact = mongoose.model('IntegrationArtifact');
const LeadCampaignSet = mongoose.model('LeadCampaignSet');
const { reserveSlot } = require('../services/capabilities/leadCampaignSetService');
const { pauseAdsCampaign } = require('../services/integrations/googleAdsCampaignClient');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/zuggernaut';
  await mongoose.connect(mongoUri);

  const legacyCampaigns = await IntegrationArtifact.find({
    provider: 'google_ads',
    artifactType: 'ads_campaign',
    'metadata.slot': { $exists: false },
  }).lean();

  console.log(`Found ${legacyCampaigns.length} legacy campaign artifact(s) without managed slot.`);

  for (const artifact of legacyCampaigns) {
    const businessId = artifact.businessId;
    const hasSet = await LeadCampaignSet.findOne({ businessId }).lean();
    const recommendedReserved = Boolean(hasSet?.recommended?.reservedAt);

    if (!recommendedReserved) {
      console.log(`[${dryRun ? 'dry-run' : 'apply'}] Reserve recommended slot for business ${businessId}`);
      if (!dryRun) {
        await reserveSlot(businessId, 'recommended', {
          action: artifact.metadata?.action ?? 'forms',
          offer: artifact.metadata?.offer ?? 'Legacy campaign',
          places: artifact.metadata?.places ?? [],
        });
        await IntegrationArtifact.updateOne(
          { _id: artifact._id },
          { $set: { 'metadata.slot': 'recommended', 'metadata.legacy': true } }
        );
      }
    }

    if (!dryRun && process.env.GOOGLE_ADS_API_ENABLED === 'true') {
      try {
        await pauseAdsCampaign({ businessId, campaignResourceName: artifact.externalId });
        console.log(`Paused legacy campaign ${artifact.externalId}`);
      } catch (err) {
        console.warn(`Could not pause ${artifact.externalId}: ${err?.message}`);
      }
    }
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
