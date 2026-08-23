'use strict';

const {
  computeBusinessIntentFingerprint,
  extractWebsiteHost,
} = require('../lib/idempotency/businessIntentFingerprint');

describe('businessIntentFingerprint', () => {
  it('is stable when scrape-only fields change', () => {
    const base = {
      businessName: 'Acme Plumbing',
      websiteUrl: 'https://www.acme.example/services',
      goals: { primary: 'calls' },
      serviceAreas: ['Austin', 'Dallas'],
      rawScrapeOutput: { headline: 'old marketing copy' },
    };
    const churned = {
      ...base,
      rawScrapeOutput: { headline: 'completely different scrape blob with PII email@x.com' },
      differentiators: 'volatile marketing fluff',
    };

    expect(computeBusinessIntentFingerprint(base)).toBe(computeBusinessIntentFingerprint(churned));
  });

  it('changes when canonical product fields change', () => {
    const a = {
      businessName: 'Acme',
      websiteUrl: 'https://acme.example',
      goals: { primary: 'calls' },
      serviceAreas: ['Austin'],
    };
    const b = {
      ...a,
      goals: { primary: 'forms' },
    };
    expect(computeBusinessIntentFingerprint(a)).not.toBe(computeBusinessIntentFingerprint(b));
  });

  it('extractWebsiteHost normalizes host only', () => {
    expect(extractWebsiteHost('https://WWW.Example.COM/path')).toBe('www.example.com');
  });
});
