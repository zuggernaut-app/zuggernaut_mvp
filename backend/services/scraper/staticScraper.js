'use strict';

const { SCRAPER_UA } = require('./robots');
const { detectBlocking } = require('./detectBlocking');
const { ssrfSafeGet, SsrfError } = require('../../lib/ssrf');
const {
  createAggregate,
  collectSignalsFromHtml,
  aggregateToExtracted,
  appShellLikely,
  getPageFetchPriority,
} = require('./htmlSignals');
const { isPageAlmostEmpty, extractPageLevelSignals } = require('./pageAlmostEmpty');
const { fetchWithFirecrawl } = require('./firecrawlClient');

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_STORED_PAGE_TEXT_CHARS = 32_768;
const FETCH_TIMEOUT_MS = 18000;
const INTER_REQUEST_DELAY_MS = Number(process.env.SCRAPER_INTER_REQUEST_DELAY_MS || 450);
const MAX_FIRECRAWL_CALLS_PER_RUN = 3;

/**
 * @param {string | null | undefined} text
 * @returns {string | undefined}
 */
function storedPageText(text) {
  if (typeof text !== 'string') return undefined;
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= MAX_STORED_PAGE_TEXT_CHARS) return trimmed;
  return trimmed.slice(0, MAX_STORED_PAGE_TEXT_CHARS);
}

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
  const res = await ssrfSafeGet(url, {
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
 * @param {string} pageUrl
 * @param {number} status
 * @param {object} sig
 * @param {string} html
 * @param {string} normalizedBase
 */
function buildPageDraft(pageUrl, status, sig, html, normalizedBase) {
  const text = storedPageText(sig.text);
  const title = sig.title || '';
  const pageSignals = extractPageLevelSignals(html, pageUrl);
  return {
    url: pageUrl,
    status,
    title,
    text,
    almostEmpty: isPageAlmostEmpty({ text, title }, pageSignals, pageUrl),
    priority: getPageFetchPriority(pageUrl, normalizedBase),
  };
}

/**
 * @param {object[]} drafts
 * @param {string} normalizedBase
 */
async function applyFirecrawlFallback(drafts, normalizedBase) {
  const sorted = [...drafts].sort((a, b) => {
    if (a.url === normalizedBase) return -1;
    if (b.url === normalizedBase) return 1;
    return b.priority - a.priority;
  });

  let calls = 0;
  for (const draft of sorted) {
    if (!draft.almostEmpty) continue;
    if (calls >= MAX_FIRECRAWL_CALLS_PER_RUN) break;
    calls += 1;
    try {
      const md = await fetchWithFirecrawl(draft.url);
      if (md) draft.text = storedPageText(md);
    } catch {
      /* keep Cheerio text */
    }
  }

  return drafts.map(({ url, status, text, title }) => ({
    url,
    status,
    text,
    title,
  }));
}

/**
 * @param {string} websiteUrl
 */
async function runStaticScrape(websiteUrl) {
  const normalized = normalizeStartUrl(websiteUrl);
  const pageDrafts = [];
  const errors = [];
  const aggregate = createAggregate();

  try {
    const first = await fetchHtml(normalized);
    if (first.status >= 400) {
      return buildFailure(
        normalized,
        `http_${first.status}`,
        [],
        [...errors, { url: normalized, message: `HTTP ${first.status}` }]
      );
    }

    detectBlocking(first.html, first.headers);
    const sig0 = collectSignalsFromHtml(first.html, normalized, normalized, aggregate);
    pageDrafts.push(buildPageDraft(normalized, first.status, sig0, first.html, normalized));

    const likely = sig0.likelyPageUrls;
    for (const pageUrl of likely) {
      await sleep(INTER_REQUEST_DELAY_MS);
      try {
        const r = await fetchHtml(pageUrl);
        if (r.status >= 400) continue;
        detectBlocking(r.html, r.headers);
        const sig = collectSignalsFromHtml(r.html, pageUrl, normalized, aggregate);
        pageDrafts.push(buildPageDraft(pageUrl, r.status, sig, r.html, normalized));
      } catch (e) {
        errors.push({
          url: pageUrl,
          message: typeof e?.message === 'string' ? e.message : 'fetch_error',
        });
      }
    }

    const pages = await applyFirecrawlFallback(pageDrafts, normalized);

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
    if (e instanceof SsrfError) {
      errors.push({
        url: normalized,
        message: e.code || 'ssrf_blocked',
      });
      return buildFailure(normalized, 'ssrf_blocked', [], errors);
    }
    errors.push({
      url: normalized,
      message: typeof e?.message === 'string' ? e.message : 'fetch_failed',
    });
    return buildFailure(normalized, 'fetch_failed', [], errors);
  }
}

module.exports = {
  runStaticScrape,
  fetchHtml,
  normalizeStartUrl,
  isPageAlmostEmpty,
  buildPageDraft,
  applyFirecrawlFallback,
};
