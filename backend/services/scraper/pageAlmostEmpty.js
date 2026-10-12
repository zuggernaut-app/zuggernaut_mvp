'use strict';

const { extractPhonesFromText, inferDefaultCountryFromUrl } = require('./phoneUtils');

const EMAIL_RE =
  /[a-zA-Z0-9._%+-]+\s*(\[at\]|@)\s*[a-zA-Z0-9.-]+\s*(\[dot\]|\.)\s*[a-zA-Z]{2,}/i;

const SERVICE_GEO_RE =
  /\b(services?|products?|plumbing|hvac|dental|roofing|cleaning|landscaping|serving|located in|service area|based in|\b[A-Z][a-z]+,\s*[A-Z]{2}\b)/i;

/**
 * True when visible page content supports at most a business name (no extra hint fields).
 *
 * @param {{ text?: string, title?: string }} page
 * @param {{ emails?: string[], phones?: string[], jsonLdNames?: string[], ogSiteName?: string | null }} extractedForPage
 */
function isPageAlmostEmpty(page, extractedForPage, pageUrl = '') {
  const text = typeof page?.text === 'string' ? page.text : '';
  const title = typeof page?.title === 'string' ? page.title.trim() : '';
  const normalized = text.replace(/\s+/g, ' ').trim();

  const emails = extractedForPage?.emails || [];
  const phones = extractedForPage?.phones || [];
  if (emails.length > 0 || phones.length > 0) return false;

  if (EMAIL_RE.test(normalized)) return false;

  let defaultCountry = 'US';
  try {
    if (pageUrl) defaultCountry = inferDefaultCountryFromUrl(new URL(pageUrl).hostname);
  } catch {
    /* keep default */
  }
  const phonesInText = extractPhonesFromText(normalized, defaultCountry);
  if (phonesInText.length > 0) return false;

  if (SERVICE_GEO_RE.test(normalized)) return false;

  const jsonLd = extractedForPage?.jsonLdNames || [];
  const og = extractedForPage?.ogSiteName ? String(extractedForPage.ogSiteName).trim() : '';
  const nameTokens = new Set(
    [title, og, ...jsonLd.map((n) => String(n).trim())].filter((s) => s.length > 2)
  );

  let remainder = normalized;
  for (const token of nameTokens) {
    remainder = remainder.split(token).join(' ').trim();
  }
  remainder = remainder.replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();

  if (remainder.length > 60) return false;
  if (/\b(call|phone|email|contact|schedule|book)\b/i.test(remainder)) return false;

  return true;
}

/**
 * Lightweight per-page signals (this HTML only) for almost-empty classification.
 *
 * @param {string} html
 * @param {string} pageUrl
 */
function extractPageLevelSignals(html, pageUrl) {
  const emails = [];
  const phones = [];
  const jsonLdNames = [];
  let ogSiteName = null;

  if (!html || typeof html !== 'string') {
    return { emails, phones, jsonLdNames, ogSiteName };
  }

  let defaultCountry = 'US';
  try {
    if (pageUrl) defaultCountry = inferDefaultCountryFromUrl(new URL(pageUrl).hostname);
  } catch {
    /* keep default */
  }
  const emailMatches = html.match(
    new RegExp(EMAIL_RE.source, 'gi')
  );
  if (emailMatches) {
    for (const m of emailMatches) {
      const e = m.replace(/\s*(\[at\]|@)\s*/gi, '@').replace(/\s*(\[dot\]|\.)\s*/gi, '.');
      if (e && !emails.includes(e)) emails.push(e);
    }
  }
  extractPhonesFromText(html, defaultCountry).forEach((p) => {
    if (p.display && !phones.includes(p.display)) phones.push(p.display);
  });

  const ogMatch = html.match(/property=["']og:site_name["']\s+content=["']([^"']+)["']/i);
  if (ogMatch?.[1]) ogSiteName = ogMatch[1].trim();

  const ldJsonBlocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (ldJsonBlocks) {
    for (const block of ldJsonBlocks) {
      const inner = block.replace(/<script[^>]*>|<\/script>/gi, '');
      try {
        const json = JSON.parse(inner);
        const nodes = Array.isArray(json) ? json : json['@graph'] ? json['@graph'] : [json];
        for (const node of nodes) {
          if (node && node.name) jsonLdNames.push(String(node.name));
        }
      } catch {
        /* skip */
      }
    }
  }

  return { emails, phones, jsonLdNames, ogSiteName };
}

module.exports = { isPageAlmostEmpty, extractPageLevelSignals };
