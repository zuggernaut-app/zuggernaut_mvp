'use strict';

const mongoose = require('mongoose');
require('../models');
const {
  claimSignupScrape,
  claimOnboardingScrape,
} = require('../services/capabilities/leadCampaignScrapeService');

const ScrapeRun = mongoose.model('ScrapeRun');

describe('leadCampaignScrapeService claim upserts', () => {
  const businessId = new mongoose.Types.ObjectId();
  const userId = new mongoose.Types.ObjectId();
  const websiteUrl = 'https://www.example.com';

  it('claimSignupScrape persists one signup ScrapeRun without Mongo path conflict', async () => {
    const result = await claimSignupScrape({ businessId, userId, websiteUrl });

    expect(result.claimed).toBe(true);
    expect(result.idempotent).toBe(false);

    const doc = await ScrapeRun.findOne({ businessId, purpose: 'signup' }).lean();
    expect(doc).toBeTruthy();
    expect(doc.purpose).toBe('signup');
    expect(doc.status).toBe('QUEUED');
    expect(doc.claimState).toBe('claiming');
    expect(doc.userId.toString()).toBe(userId.toString());
    expect(doc.websiteUrl).toBe(websiteUrl);
  });

  it('claimOnboardingScrape persists one onboarding ScrapeRun without Mongo path conflict', async () => {
    const onboardingBusinessId = new mongoose.Types.ObjectId();
    const result = await claimOnboardingScrape({
      businessId: onboardingBusinessId,
      userId,
      websiteUrl,
    });

    expect(result.claimed).toBe(true);
    expect(result.idempotent).toBe(false);

    const doc = await ScrapeRun.findOne({ businessId: onboardingBusinessId, purpose: 'onboarding' }).lean();
    expect(doc).toBeTruthy();
    expect(doc.purpose).toBe('onboarding');
    expect(doc.status).toBe('QUEUED');
    expect(doc.claimState).toBe('claiming');
    expect(doc.userId.toString()).toBe(userId.toString());
    expect(doc.websiteUrl).toBe(websiteUrl);
  });
});
