'use strict';

const { createAggregate, aggregateToExtracted } = require('./htmlSignals');
const { normalizeStartUrl } = require('./staticScraper');

/**
 * Headless scraping is disabled for user-controlled URLs — Playwright cannot enforce
 * connection-time IP pinning, so DNS rebinding would bypass pre-request checks.
 *
 * @param {string} websiteUrl
 */
async function runHeadlessScrape(websiteUrl) {
  const normalized = normalizeStartUrl(websiteUrl);
  const aggregate = createAggregate();

  return {
    strategy: 'headless',
    websiteUrl: normalized,
    pages: [],
    extractedPreview: aggregateToExtracted(aggregate, normalized),
    blocked: true,
    blockReasons: ['headless_disabled_ssrf'],
    partialBlock: false,
    errors: [
      {
        url: normalized,
        message: 'headless_disabled_ssrf',
      },
    ],
  };
}

module.exports = { runHeadlessScrape };
