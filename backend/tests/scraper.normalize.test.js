'use strict';

const { normalizeScrapeResult, mergeExtracted } = require('../services/scraper/normalize');
const { SCRAPE_QUALITY } = require('../constants/onboarding');

describe('normalizeScrapeResult', () => {
  it('merges extracted previews and scores signals', () => {
    const merged = mergeExtracted(
      {
        emails: ['a@example.com'],
        phones: [],
        socials: { Instagram: [], Facebook: [], YouTube: [], LinkedIn: [] },
        jsonLdNames: ['Acme Co'],
        metaDescription: 'Plumbing in Austin',
        ogSiteName: null,
        titles: [],
        host: 'acme.example',
      },
      {
        emails: [],
        phones: ['+15551234567'],
        socials: { Instagram: ['https://instagram.com/acme'], Facebook: [], YouTube: [], LinkedIn: [] },
        jsonLdNames: [],
        metaDescription: null,
        ogSiteName: 'Acme Plumbing',
        titles: [],
        host: 'acme.example',
      }
    );

    expect(merged.emails).toEqual(['a@example.com']);
    expect(merged.phones).toEqual(['+15551234567']);
    expect(merged.ogSiteName).toBe('Acme Plumbing');
    expect(merged.signalScore).toBeGreaterThan(2);
  });

  it('returns strong suggestions with contact methods and goals', () => {
    const { status, suggested } = normalizeScrapeResult({
      websiteUrl: 'https://acmeplumbing.example',
      scrapeRunId: '507f1f77bcf86cd799439011',
      startedAt: new Date().toISOString(),
      robots: { allowed: true },
      staticResult: {
        extractedPreview: {
          emails: ['hello@acme.example'],
          phones: ['+15551234567'],
          socials: { Instagram: [], Facebook: [], YouTube: [], LinkedIn: [] },
          jsonLdNames: ['Acme Plumbing'],
          metaDescription: 'Emergency plumbing, drain cleaning, and water heater repair in Austin',
          ogSiteName: 'Acme Plumbing',
          titles: [{ title: 'Acme Plumbing | Austin TX', url: 'https://acmeplumbing.example' }],
          host: 'acmeplumbing.example',
        },
        blocked: false,
      },
      headlessResult: null,
    });

    expect(status).toBe('SUCCEEDED');
    expect(suggested.businessName).toBe('Acme Plumbing');
    expect(suggested.industry).toMatch(/Plumbing/i);
    expect(suggested.services.length).toBeGreaterThan(0);
    expect(suggested.serviceAreas.length).toBeGreaterThan(0);
    expect(suggested.contactMethods).toMatchObject({
      emails: ['hello@acme.example'],
      phones: ['+15551234567'],
    });
    expect(suggested.goals).toMatchObject({ primary: 'generate_leads' });
    expect(suggested.scrapeQuality).toBe(SCRAPE_QUALITY.STRONG);
    expect(suggested.manualFallback).toBe(false);
  });

  it('returns manual-friendly fallback when robots block crawl', () => {
    const { status, suggested } = normalizeScrapeResult({
      websiteUrl: 'https://blocked.example',
      scrapeRunId: '507f1f77bcf86cd799439012',
      startedAt: new Date().toISOString(),
      robots: { allowed: false, reason: 'disallowed' },
      staticResult: null,
      headlessResult: null,
    });

    expect(status).toBe('BLOCKED');
    expect(suggested.manualFallback).toBe(true);
    expect(suggested.scrapeQuality).toBe(SCRAPE_QUALITY.NONE);
    expect(suggested.businessName).toBe('Blocked');
  });
});
