'use strict';

const mockScrapeActivities = {
  checkRobotsActivity: jest.fn(),
  scrapeStaticActivity: jest.fn(),
  scrapeHeadlessActivity: jest.fn(),
  normalizeScrapeActivity: jest.fn(),
  persistScrapeResultActivity: jest.fn(),
};

jest.mock('@temporalio/workflow', () => ({
  proxyActivities: jest.fn(() => mockScrapeActivities),
}));

const mongoose = require('mongoose');
const { scrapeWorkflow } = require('../workflows/scrape.workflow');

describe('scrapeWorkflow', () => {
  const ids = () => ({
    scrapeRunId: new mongoose.Types.ObjectId().toString(),
    businessId: new mongoose.Types.ObjectId().toString(),
    userId: new mongoose.Types.ObjectId().toString(),
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockScrapeActivities.checkRobotsActivity.mockResolvedValue({ allowed: true, reason: 'robots_allow' });
    mockScrapeActivities.scrapeStaticActivity.mockResolvedValue({
      strategy: 'static',
      websiteUrl: 'https://example.com',
      pages: [],
      extractedPreview: {
        emails: [],
        phones: [],
        phoneCandidates: [],
        socials: { Instagram: [], Facebook: [], YouTube: [], LinkedIn: [] },
        jsonLdNames: [],
        metaDescription: null,
        ogSiteName: null,
        titles: [],
        host: 'example.com',
      },
      blocked: false,
      blockReasons: [],
      partialBlock: false,
      recommendHeadless: false,
      appShellLikely: false,
      homepageTextLength: 500,
      errors: [],
    });
    mockScrapeActivities.normalizeScrapeActivity.mockResolvedValue({
      status: 'SUCCEEDED',
      suggested: { businessName: 'Example (draft from website)' },
      rawPayload: {
        source: 'enterprise_scraper_v1',
        schemaVersion: 1,
        status: 'SUCCEEDED',
      },
    });
    mockScrapeActivities.persistScrapeResultActivity.mockResolvedValue({ persisted: true, idempotent: false });
  });

  it('runs static only when headless not recommended', async () => {
    const id = ids();
    const out = await scrapeWorkflow({
      ...id,
      websiteUrl: 'https://example.com',
    });

    expect(mockScrapeActivities.checkRobotsActivity).toHaveBeenCalledWith({ websiteUrl: 'https://example.com' });
    expect(mockScrapeActivities.scrapeStaticActivity).toHaveBeenCalled();
    expect(mockScrapeActivities.scrapeHeadlessActivity).not.toHaveBeenCalled();
    expect(mockScrapeActivities.persistScrapeResultActivity).toHaveBeenCalled();
    expect(out.workflow).toBe('scrapeWorkflow');
    expect(out.status).toBe('SUCCEEDED');
  });

  it('runs headless when static recommends it', async () => {
    mockScrapeActivities.scrapeStaticActivity.mockResolvedValue({
      strategy: 'static',
      websiteUrl: 'https://example.com',
      pages: [],
      extractedPreview: {
        emails: [],
        phones: [],
        phoneCandidates: [],
        socials: { Instagram: [], Facebook: [], YouTube: [], LinkedIn: [] },
        jsonLdNames: [],
        metaDescription: null,
        ogSiteName: null,
        titles: [],
        host: 'example.com',
      },
      blocked: false,
      blockReasons: [],
      partialBlock: false,
      recommendHeadless: true,
      appShellLikely: true,
      homepageTextLength: 50,
      errors: [],
    });
    mockScrapeActivities.scrapeHeadlessActivity.mockResolvedValue({
      strategy: 'headless',
      websiteUrl: 'https://example.com',
      pages: [],
      extractedPreview: {
        emails: ['a@example.com'],
        phones: [],
        phoneCandidates: [],
        socials: { Instagram: [], Facebook: [], YouTube: [], LinkedIn: [] },
        jsonLdNames: [],
        metaDescription: null,
        ogSiteName: null,
        titles: [],
        host: 'example.com',
      },
      blocked: false,
      blockReasons: [],
      partialBlock: false,
      errors: [],
    });

    await scrapeWorkflow({
      ...ids(),
      websiteUrl: 'https://example.com',
    });

    expect(mockScrapeActivities.scrapeHeadlessActivity).toHaveBeenCalled();
  });

  it('skips fetch activities when robots disallow', async () => {
    mockScrapeActivities.checkRobotsActivity.mockResolvedValue({ allowed: false, reason: 'robots_disallow' });
    mockScrapeActivities.normalizeScrapeActivity.mockResolvedValue({
      status: 'BLOCKED',
      suggested: { businessName: 'X (draft from website)' },
      rawPayload: { source: 'enterprise_scraper_v1', status: 'BLOCKED' },
    });

    const id = ids();
    await scrapeWorkflow({ ...id, websiteUrl: 'https://example.com' });

    expect(mockScrapeActivities.scrapeStaticActivity).not.toHaveBeenCalled();
    expect(mockScrapeActivities.scrapeHeadlessActivity).not.toHaveBeenCalled();
    expect(mockScrapeActivities.normalizeScrapeActivity).toHaveBeenCalled();
  });

  it('returns FAILED when required fields missing', async () => {
    const out = await scrapeWorkflow({});
    expect(out.status).toBe('FAILED');
    expect(mockScrapeActivities.checkRobotsActivity).not.toHaveBeenCalled();
  });
});
