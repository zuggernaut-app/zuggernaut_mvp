'use strict';

const axios = require('axios');
const { SCRAPER_UA } = require('./robots');
const { detectBlocking } = require('./detectBlocking');
const {
  createAggregate,
  collectSignalsFromHtml,
  aggregateToExtracted,
  appShellLikely,
} = require('./htmlSignals');

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 18000;
const INTER_REQUEST_DELAY_MS = Number(process.env.SCRAPER_INTER_REQUEST_DELAY_MS || 450);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeStartUrl(url) {
  let u = String(url).trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

/**
 * @param {string} url
 */
async function fetchHtml(url) {
  const res = await axios.get(url, {
    timeout: FETCH_TIMEOUT_MS,
    maxRedirects: 5,
    maxContentLength: MAX_BODY_BYTES,
    validateStatus: (s) => s >= 200 && s < 400,
    headers: {
      'User-Agent': SCRAPER_UA,
      Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    responseType: 'text',
  });
  const headers = {};
  if (res.headers && typeof res.headers === 'object') {
    for (const [k, v] of Object.entries(res.headers)) {
      if (typeof v === 'string') headers[k] = v;
      else if (Array.isArray(v)) headers[k] = v.join(', ');
    }
  }
  const html = typeof res.data === 'string' ? res.data : String(res.data ?? '');
  return { status: res.status, html, headers };
}

function emptyExtracted(baseUrl) {
  return aggregateToExtracted(createAggregate(), baseUrl || 'https://example.com');
}

function buildFailure(websiteUrl, code, pages, errors) {
  const base = normalizeStartUrl(websiteUrl);
  return {
    strategy: 'static',
    websiteUrl: base,
    pages,
    extractedPreview: emptyExtracted(base),
    blocked: true,
    blockReasons: [code],
    partialBlock: false,
    recommendHeadless: true,
    appShellLikely: false,
    homepageTextLength: 0,
    errors,
  };
}

/**
 * @param {string} websiteUrl
 */
async function runStaticScrape(websiteUrl) {
  const normalized = normalizeStartUrl(websiteUrl);
  const pages = [];
  const errors = [];
  const aggregate = createAggregate();

  try {
    const first = await fetchHtml(normalized);
    if (first.status >= 400) {
      return buildFailure(
        normalized,
        `http_${first.status}`,
        pages,
        [...errors, { url: normalized, message: `HTTP ${first.status}` }]
      );
    }

    const firstBlock = detectBlocking(first.html, first.headers);
    const sig0 = collectSignalsFromHtml(first.html, normalized, normalized, aggregate);
    pages.push({
      url: normalized,
      title: sig0.title || '',
      textLength: sig0.textLength,
      strategy: 'static',
      status: first.status,
      blockHints: firstBlock.reasons,
    });

    const likely = sig0.likelyPageUrls;
    for (const pageUrl of likely) {
      await sleep(INTER_REQUEST_DELAY_MS);
      try {
        const r = await fetchHtml(pageUrl);
        if (r.status >= 400) continue;
        const pb = detectBlocking(r.html, r.headers);
        const sig = collectSignalsFromHtml(r.html, pageUrl, normalized, aggregate);
        pages.push({
          url: pageUrl,
          title: sig.title || '',
          textLength: sig.textLength,
          strategy: 'static',
          status: r.status,
          blockHints: pb.reasons,
        });
      } catch (e) {
        errors.push({
          url: pageUrl,
          message: typeof e?.message === 'string' ? e.message : 'fetch_error',
        });
      }
    }

    const extractedPreview = aggregateToExtracted(aggregate, normalized);
    const block2 = detectBlocking(first.html, first.headers);
    const shell = appShellLikely(first.html);

    const signalScore =
      extractedPreview.emails.length +
      extractedPreview.phones.length +
      Object.values(extractedPreview.socials).flat().length +
      (extractedPreview.jsonLdNames.length > 0 ? 2 : 0);

    const recommendHeadless =
      block2.blocked ||
      block2.partialBlock ||
      shell ||
      sig0.textLength < 350 ||
      signalScore === 0;

    return {
      strategy: 'static',
      websiteUrl: normalized,
      pages,
      extractedPreview,
      blocked: block2.blocked,
      blockReasons: block2.reasons,
      partialBlock: block2.partialBlock,
      recommendHeadless,
      appShellLikely: shell,
      homepageTextLength: sig0.textLength,
      errors,
    };
  } catch (e) {
    errors.push({
      url: normalized,
      message: typeof e?.message === 'string' ? e.message : 'fetch_failed',
    });
    return buildFailure(normalized, 'fetch_failed', pages, errors);
  }
}

module.exports = { runStaticScrape, fetchHtml, normalizeStartUrl };
