'use strict';

const { SCRAPER_UA } = require('./robots');
const { detectBlocking } = require('./detectBlocking');
const {
  createAggregate,
  collectSignalsFromHtml,
  aggregateToExtracted,
} = require('./htmlSignals');
const { normalizeStartUrl } = require('./staticScraper');

const NAV_TIMEOUT_MS = 45000;
const POST_NAV_IDLE_MS = 1500;

/**
 * @param {string} websiteUrl
 */
async function runHeadlessScrape(websiteUrl) {
  const { chromium } = require('playwright');
  const normalized = normalizeStartUrl(websiteUrl);
  const errors = [];
  const pages = [];
  const aggregate = createAggregate();
  /** @type {import('playwright').Browser | null} */
  let browser = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: SCRAPER_UA,
      locale: 'en-US',
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

    await page.goto(normalized, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
    await new Promise((r) => setTimeout(r, POST_NAV_IDLE_MS));

    let html = await page.content();
    let block = detectBlocking(html, {});
    const sig0 = collectSignalsFromHtml(html, normalized, normalized, aggregate);
    pages.push({
      url: normalized,
      title: sig0.title || '',
      textLength: sig0.textLength,
      strategy: 'headless',
      status: 200,
      blockHints: block.reasons,
    });

    const likely = sig0.likelyPageUrls;
    for (const pageUrl of likely) {
      try {
        await page.goto(pageUrl, { waitUntil: 'load', timeout: NAV_TIMEOUT_MS });
        await new Promise((r) => setTimeout(r, POST_NAV_IDLE_MS));
        html = await page.content();
        block = detectBlocking(html, {});
        const sig = collectSignalsFromHtml(html, pageUrl, normalized, aggregate);
        pages.push({
          url: pageUrl,
          title: sig.title || '',
          textLength: sig.textLength,
          strategy: 'headless',
          status: 200,
          blockHints: block.reasons,
        });
      } catch (e) {
        errors.push({
          url: pageUrl,
          message: typeof e?.message === 'string' ? e.message : 'headless_nav_error',
        });
      }
    }

    await context.close();
    await browser.close();
    browser = null;

    const lastHtml = html;
    const finalBlock = detectBlocking(lastHtml, {});
    const extractedPreview = aggregateToExtracted(aggregate, normalized);

    return {
      strategy: 'headless',
      websiteUrl: normalized,
      pages,
      extractedPreview,
      blocked: finalBlock.blocked,
      blockReasons: finalBlock.reasons,
      partialBlock: finalBlock.partialBlock,
      errors,
    };
  } catch (e) {
    if (browser) {
      await browser.close().catch(() => {});
    }
    const agg = createAggregate();
    return {
      strategy: 'headless',
      websiteUrl: normalized,
      pages,
      extractedPreview: aggregateToExtracted(agg, normalized),
      blocked: true,
      blockReasons: ['headless_failed'],
      partialBlock: false,
      errors: [
        ...errors,
        {
          url: normalized,
          message: typeof e?.message === 'string' ? e.message : 'headless_failed',
        },
      ],
    };
  }
}

module.exports = { runHeadlessScrape };
