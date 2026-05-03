'use strict';

const { URL } = require('url');

/**
 * Deterministic placeholder scraper (superseded by Temporal `scrapeWorkflow` + `enterprise_scraper_v1`).
 * Retained for reference/tests. Never writes to confirmed BusinessContext fields.
 *
 * @param {string} websiteUrl
 * @returns {{ suggested: Record<string, unknown>, rawPayload: Record<string, unknown> }}
 */
function runPlaceholderScrape(websiteUrl) {
  let host = 'unknown-host';
  try {
    host = new URL(
      websiteUrl.startsWith('http') ? websiteUrl : `https://${websiteUrl}`
    ).hostname.replace(/^www\./, '');
  } catch {
    /* keep default */
  }

  const brandGuess = host.split('.')[0] || 'business';
  const prettyName =
    brandGuess.length > 0
      ? `${brandGuess.charAt(0).toUpperCase()}${brandGuess.slice(1)}`
      : 'Your business';

  const suggested = {
    businessName: `${prettyName} (draft from URL)`,
    industry: 'Local services',
    services: ['Core service offering', 'Consultation'],
    serviceAreas: ['Service area TBD'],
    differentiators: 'Placeholder until live scrape runs.',
    orderValueHint: 'unknown',
  };

  const rawPayload = {
    source: 'placeholder_v1',
    websiteUrl,
    host,
    extractedAt: new Date().toISOString(),
    hints: suggested,
  };

  return { suggested, rawPayload };
}

module.exports = { runPlaceholderScrape };
