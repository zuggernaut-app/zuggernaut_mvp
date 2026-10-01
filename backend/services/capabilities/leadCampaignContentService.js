'use strict';

const { isLlmEnabled, completeJson, LlmClientError } = require('../ai/llmClient');

const MODEL_PAGE_TEXT_CHARS = 4000;

/**
 * @param {object | null | undefined} rawScrapeOutput
 * @returns {object | null}
 */
function getLatestScrapeRun(rawScrapeOutput) {
  const runs =
    rawScrapeOutput &&
    typeof rawScrapeOutput === 'object' &&
    Array.isArray(rawScrapeOutput.runs)
      ? rawScrapeOutput.runs
      : [];
  if (runs.length === 0) return null;
  const latest = runs[runs.length - 1];
  return latest && typeof latest === 'object' ? latest : null;
}

/**
 * @param {object | null | undefined} rawScrapeOutput
 * @returns {string[]}
 */
function extractScrapeTextCorpus(rawScrapeOutput) {
  const latest = getLatestScrapeRun(rawScrapeOutput);
  if (!latest) return [];

  const texts = [];
  const extracted = latest.extracted;
  if (extracted && typeof extracted === 'object') {
    if (typeof extracted.metaDescription === 'string' && extracted.metaDescription.trim()) {
      texts.push(extracted.metaDescription.trim());
    }
    if (Array.isArray(extracted.titles)) {
      for (const entry of extracted.titles) {
        if (entry && typeof entry.title === 'string' && entry.title.trim()) {
          texts.push(entry.title.trim());
        }
      }
    }
  }

  if (Array.isArray(latest.pages)) {
    for (const page of latest.pages) {
      if (page && typeof page.title === 'string' && page.title.trim()) {
        texts.push(page.title.trim());
      }
      if (page && typeof page.text === 'string' && page.text.trim()) {
        texts.push(page.text.trim());
      }
    }
  }

  return texts;
}

/**
 * @param {object | null | undefined} rawScrapeOutput
 * @returns {{ url: string, title: string, text: string }[]}
 */
function extractScrapePages(rawScrapeOutput) {
  const latest = getLatestScrapeRun(rawScrapeOutput);
  if (!latest || !Array.isArray(latest.pages)) return [];

  const pages = [];
  for (const page of latest.pages) {
    if (!page || typeof page.url !== 'string' || !page.url.trim()) continue;
    pages.push({
      url: page.url.trim(),
      title: typeof page.title === 'string' ? page.title.trim() : '',
      text: typeof page.text === 'string' ? page.text.trim() : '',
    });
  }
  return pages;
}

/**
 * @param {string | null | undefined} offer
 * @returns {string[]}
 */
function tokenizeOffer(offer) {
  if (typeof offer !== 'string' || !offer.trim()) return [];
  return offer
    .toLowerCase()
    .split(/\W+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 2);
}

/**
 * @param {string | null | undefined} offer
 * @param {{ title?: string, text?: string }} page
 */
function scorePageForOffer(offer, page) {
  const tokens = tokenizeOffer(offer);
  if (tokens.length === 0) return 0;
  const haystack = `${page?.title ?? ''} ${page?.text ?? ''}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) score += 1;
  }
  return score;
}

/**
 * @param {string | null | undefined} offer
 * @param {{ url: string, title?: string, text?: string }[]} pages
 * @param {string | null | undefined} websiteUrl
 * @returns {string | null}
 */
function selectLandingPage(offer, pages, websiteUrl) {
  const fallback =
    typeof websiteUrl === 'string' && websiteUrl.trim() ? websiteUrl.trim() : null;
  const validPages = Array.isArray(pages)
    ? pages.filter((page) => page && typeof page.url === 'string' && page.url.trim())
    : [];

  let bestUrl = null;
  let bestScore = 0;
  for (const page of validPages) {
    const score = scorePageForOffer(offer, page);
    if (score > bestScore) {
      bestScore = score;
      bestUrl = page.url.trim();
    }
  }

  return bestScore > 0 && bestUrl ? bestUrl : fallback;
}

/**
 * @param {{ url: string, title?: string, text?: string }} page
 */
function pageForModelPrompt(page) {
  const text = typeof page.text === 'string' ? page.text : '';
  return {
    url: page.url,
    title: page.title ?? '',
    text: text.length > MODEL_PAGE_TEXT_CHARS ? text.slice(0, MODEL_PAGE_TEXT_CHARS) : text,
  };
}

/**
 * @param {string | null | undefined} proofLine
 * @param {string[]} corpusTexts
 */
function proofLineMatchesScrapeCorpus(proofLine, corpusTexts) {
  const trimmed = typeof proofLine === 'string' ? proofLine.trim() : '';
  if (!trimmed) return false;
  return corpusTexts.some((text) => typeof text === 'string' && text.includes(trimmed));
}

/**
 * @param {object} input
 */
async function generateFiveAnswersFromScrape(input) {
  if (!isLlmEnabled()) {
    if (process.env.NODE_ENV === 'test') {
      return input.suggested ?? {};
    }
    return {};
  }

  try {
    const result = await completeJson({
      system:
        'Return strict JSON with optional keys: services, serviceAreas, whoBuysToday, orderValueHint, howBuyersContact. Never invent phone numbers or emails.',
      user: JSON.stringify({
        businessName: input.businessName ?? null,
        websiteUrl: input.websiteUrl ?? null,
        scrapeSignals: input.suggested ?? {},
      }),
    });
    return result && typeof result === 'object' ? result : {};
  } catch (err) {
    if (err instanceof LlmClientError) {
      return {};
    }
    throw err;
  }
}

/**
 * @param {object} input
 */
async function generateCampaignSlotContent(input) {
  if (!isLlmEnabled()) {
    if (process.env.NODE_ENV === 'test') {
      return {
        proofLine: null,
        keywords: [],
        headlines: input.fallbackHeadlines ?? [],
        descriptions: input.fallbackDescriptions ?? [],
      };
    }
    return null;
  }

  const scrapePages = Array.isArray(input.scrapePages) ? input.scrapePages : [];
  const pagesForPrompt = scrapePages.map(pageForModelPrompt);

  try {
    const result = await completeJson({
      system:
        'Return strict JSON: proofLine, proofSourceUrl, keywords[], headlines[], descriptions[]. Use only provided facts and scrape pages. Keywords must be buyer search phrases for the offer in the listed places. Headlines and descriptions must reference the offer, proof line when present, and call-to-action. No phone/email in copy. Do not invent URLs.',
      user: JSON.stringify({
        slot: input.slot,
        businessName: input.businessName,
        offer: input.offer,
        action: input.action,
        places: input.places,
        websiteUrl: input.websiteUrl,
        scrapePages: pagesForPrompt,
      }),
    });
    if (!result || typeof result !== 'object') return null;

    const corpus = Array.isArray(input.scrapeTextCorpus) ? input.scrapeTextCorpus : [];
    if (
      result.proofLine &&
      corpus.length > 0 &&
      !proofLineMatchesScrapeCorpus(result.proofLine, corpus)
    ) {
      result.proofLine = null;
      result.proofSourceUrl = null;
    } else if (result.proofLine && corpus.length === 0) {
      result.proofLine = null;
      result.proofSourceUrl = null;
    }

    delete result.landingPageUrl;

    return result;
  } catch {
    return null;
  }
}

module.exports = {
  extractScrapeTextCorpus,
  extractScrapePages,
  selectLandingPage,
  proofLineMatchesScrapeCorpus,
  generateFiveAnswersFromScrape,
  generateCampaignSlotContent,
};
