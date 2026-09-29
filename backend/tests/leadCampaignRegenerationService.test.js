'use strict';

const mongoose = require('mongoose');
const { regenerateCampaignSlotAd } = require('../services/capabilities/leadCampaignRegenerationService');
const { reserveSlot } = require('../services/capabilities/leadCampaignSetService');
const { sendBackCampaignSlot } = require('../services/capabilities/leadCampaignOperatorService');

describe('leadCampaignRegenerationService', () => {
  it('regenerates ad idempotently for sent_back slot', async () => {
    const BusinessContext = mongoose.model('BusinessContext');
    const User = mongoose.model('User');
    const SetupRun = mongoose.model('SetupRun');
    const IntegrationConnection = mongoose.model('IntegrationConnection');
    const IntegrationArtifact = mongoose.model('IntegrationArtifact');
    const CampaignPlan = mongoose.model('CampaignPlan');
    const { encryptToken } = require('../lib/crypto/tokenEncryption');

    process.env.GOOGLE_ADS_API_MOCK = 'true';

    const user = await User.create({ email: 'regen@test.com' });
    const bc = await BusinessContext.create({
      userId: user._id,
      confirmedAt: new Date(),
      businessName: 'Regen Co',
      websiteUrl: 'https://regen.example',
      services: ['Plumbing'],
      serviceAreas: ['Austin'],
      goals: { primary: 'forms' },
    });
    const run = await SetupRun.create({ businessId: bc.businessId, status: 'SUCCEEDED' });

    await IntegrationConnection.create({
      businessId: bc.businessId,
      provider: 'google_ads',
      connectionHealth: 'connected',
      accessTokenEnc: encryptToken('tok'),
      refreshTokenEnc: encryptToken('ref'),
      tokenExpiryAt: new Date(Date.now() + 3600_000),
      scopes: ['https://www.googleapis.com/auth/adwords'],
      providerIdentifiers: { customerId: '1234567890' },
    });

    await reserveSlot(bc.businessId, 'recommended', {
      action: 'forms',
      offer: 'Plumbing',
      places: ['Austin'],
    });

    await IntegrationArtifact.create({
      setupRunId: run._id,
      businessId: bc.businessId,
      provider: 'google_ads',
      artifactType: 'ads_ad_group',
      externalId: 'customers/1234567890/adGroups/1',
      idempotencyKey: `ads-${run._id}-recommended:ad_group`,
      metadata: { slot: 'recommended' },
    });

    await CampaignPlan.create({
      businessId: bc.businessId,
      setupRunId: run._id,
      slot: 'recommended',
      status: 'applied',
      intent: {
        ad: {
          finalUrl: 'https://regen.example',
          headlines: ['H1', 'H2', 'H3'],
          descriptions: ['D1', 'D2'],
        },
      },
    });

    await sendBackCampaignSlot(bc.businessId, 'recommended', 'offer_not_clear', 'fix offer');

    const first = await regenerateCampaignSlotAd(bc.businessId, 'recommended');
    expect(first.idempotent).toBe(false);
    expect(first.adResourceName).toBeTruthy();

    const LeadCampaignSet = mongoose.model('LeadCampaignSet');
    const after = await LeadCampaignSet.findOne({ businessId: bc.businessId }).lean();
    expect(after.recommended.reviewStatus).toBe('pending_review');

    await LeadCampaignSet.updateOne(
      { businessId: bc.businessId },
      { $set: { 'recommended.reviewStatus': 'sent_back' } }
    );
    const second = await regenerateCampaignSlotAd(bc.businessId, 'recommended');
    expect(second.idempotent).toBe(true);

    const adCount = await IntegrationArtifact.countDocuments({
      businessId: bc.businessId,
      artifactType: 'ads_ad',
      'metadata.regenerationNumber': 1,
    });
    expect(adCount).toBe(1);
  });
});
