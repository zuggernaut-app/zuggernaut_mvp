'use strict';

const {
  extractScrapePages,
  selectLandingPage,
  proofLineMatchesScrapeCorpus,
  generateCampaignSlotContent,
} = require('../services/capabilities/leadCampaignContentService');

describe('leadCampaignContentService', () => {
  const rawScrapeOutput = {
    runs: [
      {
        pages: [
          {
            url: 'https://example.com/',
            title: 'Home',
            text: 'Welcome to our plumbing services.',
          },
          {
            url: 'https://example.com/emergency-plumbing',
            title: 'Emergency Plumbing Austin',
            text: 'Fast emergency plumbing repair in Austin, TX.',
          },
        ],
        extracted: {
          metaDescription: 'Plumbing in Austin',
          titles: [{ title: 'Home' }],
        },
      },
    ],
  };

  it('extractScrapePages returns latest run pages with urls only', () => {
    const pages = extractScrapePages(rawScrapeOutput);
    expect(pages).toHaveLength(2);
    expect(pages[1]).toMatchObject({
      url: 'https://example.com/emergency-plumbing',
      title: 'Emergency Plumbing Austin',
    });
    expect(extractScrapePages({ runs: [{ pages: [{ title: 'No URL' }] }] })).toEqual([]);
  });

  it('selectLandingPage prefers the page that matches the offer', () => {
    const pages = extractScrapePages(rawScrapeOutput);
    expect(selectLandingPage('emergency plumbing', pages, 'https://example.com/')).toBe(
      'https://example.com/emergency-plumbing'
    );
  });

  it('selectLandingPage falls back to website root when no page matches', () => {
    const pages = extractScrapePages(rawScrapeOutput);
    expect(selectLandingPage('roofing', pages, 'https://example.com/')).toBe('https://example.com/');
  });

  it('proofLineMatchesScrapeCorpus requires an exact substring', () => {
    const corpus = ['Fast emergency plumbing repair in Austin, TX.'];
    expect(proofLineMatchesScrapeCorpus('emergency plumbing repair', corpus)).toBe(true);
    expect(proofLineMatchesScrapeCorpus('not on the site', corpus)).toBe(false);
  });

  it('generateCampaignSlotContent clears proof lines absent from the corpus when LLM is off', async () => {
    const originalLlmEnabled = process.env.LLM_ENABLED;
    process.env.LLM_ENABLED = 'false';
    process.env.NODE_ENV = 'test';

    const result = await generateCampaignSlotContent({
      slot: 'recommended',
      businessName: 'Acme',
      offer: 'plumbing',
      action: 'forms',
      places: ['Austin'],
      websiteUrl: 'https://example.com/',
      scrapePages: extractScrapePages(rawScrapeOutput),
      scrapeTextCorpus: ['Plumbing in Austin'],
      fallbackHeadlines: ['H1', 'H2', 'H3'],
      fallbackDescriptions: ['D1', 'D2'],
    });

    expect(result).toMatchObject({
      proofLine: null,
      headlines: ['H1', 'H2', 'H3'],
    });
    expect(result).not.toHaveProperty('landingPageUrl');

    process.env.LLM_ENABLED = originalLlmEnabled;
  });
});
