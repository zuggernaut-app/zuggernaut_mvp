'use strict';

const mongoose = require('mongoose');
const { createBareUser } = require('./helpers');
const { persistScrapeResultActivity, scrapeHintsActivity } = require('../activities/scrapeActivities');

describe('persistScrapeResultActivity', () => {
  it('appends raw scrape run idempotently', async () => {
    const user = await createBareUser('persist@test.com');
    const BusinessContext = mongoose.model('BusinessContext');
    const ScrapeRun = mongoose.model('ScrapeRun');

    const draft = await BusinessContext.create({ userId: user._id });
    const bid = draft.businessId.toString();
    const scrapeRun = await ScrapeRun.create({
      businessId: draft.businessId,
      userId: user._id,
      websiteUrl: 'https://example.com',
      status: 'RUNNING',
    });

    const payload = {
      scrapeRunId: scrapeRun._id.toString(),
      businessId: bid,
      userId: user._id.toString(),
      websiteUrl: 'https://example.com',
      status: 'SUCCEEDED',
      suggested: { businessName: 'T' },
      rawPayload: {
        source: 'enterprise_scraper_v1',
        schemaVersion: 1,
        scrapeRunId: scrapeRun._id.toString(),
        websiteUrl: 'https://example.com',
        status: 'SUCCEEDED',
      },
    };

    await persistScrapeResultActivity(payload);
    await persistScrapeResultActivity(payload);

    const doc = await BusinessContext.findOne({ businessId: draft.businessId })
      .select('+rawScrapeOutput')
      .lean();
    expect(doc.rawScrapeOutput.runs.length).toBe(1);

    const afterPersist = await ScrapeRun.findById(scrapeRun._id).lean();
    expect(afterPersist.status).toBe('RUNNING');
    expect(afterPersist.persistedAt).toBeTruthy();

    await scrapeHintsActivity({
      scrapeRunId: scrapeRun._id.toString(),
      businessId: bid,
      userId: user._id.toString(),
      terminalStatus: 'SUCCEEDED',
    });

    const refreshed = await ScrapeRun.findById(scrapeRun._id).lean();
    expect(refreshed.status).toBe('SUCCEEDED');
  });

  it('signup persist does not set websiteUrl when business has no website', async () => {
    const user = await createBareUser('signup-no-web@test.com');
    const BusinessContext = mongoose.model('BusinessContext');
    const ScrapeRun = mongoose.model('ScrapeRun');

    const draft = await BusinessContext.create({ userId: user._id, websiteUrl: undefined });
    const bid = draft.businessId.toString();
    const scrapeRun = await ScrapeRun.create({
      businessId: draft.businessId,
      userId: user._id,
      purpose: 'signup',
      websiteUrl: 'https://example.com',
      status: 'RUNNING',
    });

    await persistScrapeResultActivity({
      scrapeRunId: scrapeRun._id.toString(),
      businessId: bid,
      userId: user._id.toString(),
      websiteUrl: 'https://example.com',
      status: 'SUCCEEDED',
      suggested: { businessName: 'T' },
      rawPayload: {
        source: 'enterprise_scraper_v1',
        schemaVersion: 1,
        scrapeRunId: scrapeRun._id.toString(),
        websiteUrl: 'https://example.com',
        status: 'SUCCEEDED',
      },
    });

    const doc = await BusinessContext.findOne({ businessId: draft.businessId })
      .select('+rawScrapeOutput')
      .lean();
    expect(doc.websiteUrl).toBeFalsy();
    expect(doc.rawScrapeOutput.runs.length).toBe(1);
  });
});
