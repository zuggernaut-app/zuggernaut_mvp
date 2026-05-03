'use strict';

const cheerio = require('cheerio');
const {
  parseInternationalPhone,
  extractPhonesFromText,
  inferDefaultCountryFromUrl,
} = require('./phoneUtils');

const MAX_ADDITIONAL_PAGES = 3;
const LIKELY_CONTACT_PATHS = [
  '/contact',
  '/contact-us',
  '/about',
  '/about-us',
  '/locations',
  '/location',
  '/service-area',
  '/service-areas',
];
const PAGE_HINT_PATTERNS = [/contact/i, /about/i, /location/i, /service-area/i];
const HIGH_SIGNAL_PHONE_SELECTORS = [
  'header',
  'nav',
  'footer',
  'address',
  '.top-bar',
  '.header-top',
  "[class*='header']",
  "[class*='footer']",
  "[class*='contact']",
  "[class*='phone']",
  "[class*='call']",
  "[class*='cta']",
  'a',
  'button',
].join(', ');

function normalizeEmail(value) {
  if (!value) return null;
  let v = String(value)
    .replace(/^mailto:/i, '')
    .split('?')[0]
    .trim();
  return v
    .replace(/\s*(\[at\]|@)\s*/gi, '@')
    .replace(/\s*(\[dot\]|\.)\s*/gi, '.')
    .trim() || null;
}

function extractJsonLdNodes(value, collection = []) {
  if (!value) return collection;
  if (Array.isArray(value)) {
    value.forEach((entry) => extractJsonLdNodes(entry, collection));
    return collection;
  }
  if (typeof value === 'object') {
    collection.push(value);
    if (value['@graph']) extractJsonLdNodes(value['@graph'], collection);
    if (value.contactPoint) extractJsonLdNodes(value.contactPoint, collection);
  }
  return collection;
}

function normalizePageUrl(candidate, baseUrl) {
  if (!candidate) return null;
  try {
    const resolved = new URL(candidate, baseUrl);
    if (!['http:', 'https:'].includes(resolved.protocol)) return null;
    resolved.hash = '';
    return resolved.toString();
  } catch {
    return null;
  }
}

function isSameOrigin(candidate, baseUrl) {
  try {
    return new URL(candidate).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

function getPageBoost(pageUrl, baseUrl) {
  if (pageUrl === baseUrl) return 0;
  const pathName = new URL(pageUrl).pathname.toLowerCase();
  if (pathName.includes('contact')) return 3;
  if (pathName.includes('location') || pathName.includes('service-area')) return 2;
  if (pathName.includes('about')) return 1;
  return 0;
}

function getLikelyPageUrls($, baseUrl) {
  const discovered = new Set();
  const normalizedBaseUrl = normalizePageUrl(baseUrl, baseUrl);

  const addCandidate = (value) => {
    const normalized = normalizePageUrl(value, baseUrl);
    if (!normalized || normalized === normalizedBaseUrl || !isSameOrigin(normalized, baseUrl)) {
      return;
    }
    discovered.add(normalized);
  };

  LIKELY_CONTACT_PATHS.forEach(addCandidate);

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const linkText = $(el).text().trim();
    const normalized = normalizePageUrl(href, baseUrl);
    if (!normalized || normalized === normalizedBaseUrl || !isSameOrigin(normalized, baseUrl)) {
      return;
    }
    const haystack = `${href || ''} ${linkText}`.toLowerCase();
    if (PAGE_HINT_PATTERNS.some((pattern) => pattern.test(haystack))) {
      discovered.add(normalized);
    }
  });

  return [...discovered]
    .sort((a, b) => getPageBoost(b, baseUrl) - getPageBoost(a, baseUrl))
    .slice(0, MAX_ADDITIONAL_PAGES);
}

function mergeUnique(target, values) {
  values.forEach((value) => {
    if (value && !target.includes(value)) target.push(value);
  });
}

function getPhoneCandidateConfidence(candidate) {
  const hasStrongSource =
    candidate.sources.includes('tel') || candidate.sources.includes('jsonld');
  const pageCount = candidate.pages.length;
  if (hasStrongSource || pageCount >= 2 || candidate.score >= 8) return 'high';
  if (candidate.score >= 4) return 'medium';
  return 'low';
}

function shouldKeepPhoneCandidate(candidate) {
  return getPhoneCandidateConfidence(candidate) !== 'low';
}

function getContextualPhoneScore(text = '') {
  const normalized = text.toLowerCase();
  if (
    /emergency|call right away|call now|call today|available 24\/7|book now/.test(normalized)
  ) {
    return 5;
  }
  if (/phone|call|contact us|contact|book online|schedule/.test(normalized)) return 3;
  return 2;
}

function trackPhoneCandidate(aggregate, dedupeKey, pageUrl, source, score, parsed) {
  const existing = aggregate.phoneMetadata.get(dedupeKey) || {
    phone: parsed.display,
    e164: parsed.e164,
    country: parsed.country,
    score: 0,
    sources: [],
    pages: [],
  };
  existing.score += score;
  if (source && !existing.sources.includes(source)) existing.sources.push(source);
  if (pageUrl && !existing.pages.includes(pageUrl)) existing.pages.push(pageUrl);
  existing.confidence = getPhoneCandidateConfidence(existing);
  aggregate.phoneMetadata.set(dedupeKey, existing);
}

function createAggregate() {
  return {
    phoneScores: new Map(),
    phoneMetadata: new Map(),
    emailSet: new Set(),
    socials: {
      Instagram: [],
      Facebook: [],
      YouTube: [],
      LinkedIn: [],
    },
    jsonLdNames: [],
    metaDescription: null,
    ogSiteName: null,
    titles: [],
  };
}

/**
 * @param {string} html
 * @param {string} pageUrl
 * @param {string} baseUrl
 * @param {ReturnType<createAggregate>} aggregate
 */
function collectSignalsFromHtml(html, pageUrl, baseUrl, aggregate) {
  const $ = cheerio.load(html);
  const bodyText = $('body').length ? $('body').text() : '';
  const text = bodyText;
  const pageBoost = getPageBoost(pageUrl, baseUrl);
  const defaultCountry = inferDefaultCountryFromUrl(new URL(baseUrl).hostname);

  const addEmail = (email) => {
    const normalized = normalizeEmail(email);
    if (normalized) aggregate.emailSet.add(normalized);
  };

  const addParsedPhone = (parsed, score = 1, source = 'text') => {
    if (!parsed) return;
    const weightedScore = score + pageBoost;
    const key = parsed.dedupeKey;
    aggregate.phoneScores.set(key, (aggregate.phoneScores.get(key) || 0) + weightedScore);
    trackPhoneCandidate(aggregate, key, pageUrl, source, weightedScore, parsed);
  };

  const addPhone = (phone, score = 1, source = 'text') => {
    addParsedPhone(parseInternationalPhone(phone, defaultCountry), score, source);
  };

  const t = $('title').first().text().trim();
  if (t) aggregate.titles.push({ url: pageUrl, title: t });

  const md = $('meta[name="description"]').attr('content');
  if (md && typeof md === 'string' && md.trim()) {
    aggregate.metaDescription = aggregate.metaDescription || md.trim();
  }
  const og = $('meta[property="og:site_name"]').attr('content');
  if (og && typeof og === 'string' && og.trim()) {
    aggregate.ogSiteName = aggregate.ogSiteName || og.trim();
  }

  $('a[href^="mailto:"]').each((_, el) => {
    addEmail($(el).attr('href'));
  });

  $('a[href^="tel:"]').each((_, el) => {
    addPhone($(el).attr('href'), 5, 'tel');
  });

  const foundEmails = [
    ...text.matchAll(
      /[a-zA-Z0-9._%+-]+\s*(\[at\]|@)\s*[a-zA-Z0-9.-]+\s*(\[dot\]|\.)\s*[a-zA-Z]{2,}/gi
    ),
  ].map((match) => match[0]);
  foundEmails.forEach(addEmail);
  extractPhonesFromText(text, defaultCountry).forEach((parsed) => {
    addParsedPhone(parsed, 1, 'text-scan');
  });

  $(HIGH_SIGNAL_PHONE_SELECTORS).each((_, el) => {
    const elementText = $(el).text().trim();
    if (!elementText) return;
    extractPhonesFromText(elementText, defaultCountry).forEach((parsed) => {
      addParsedPhone(parsed, getContextualPhoneScore(elementText), 'context');
    });
  });

  $('a[href*="instagram.com"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) aggregate.socials.Instagram.push(href);
  });
  $('a[href*="facebook.com"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) aggregate.socials.Facebook.push(href);
  });
  $('a[href*="youtube.com"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) aggregate.socials.YouTube.push(href);
  });
  $('a[href*="linkedin.com"]').each((_, el) => {
    const href = $(el).attr('href');
    if (href) aggregate.socials.LinkedIn.push(href);
  });

  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const raw = $(el).html();
      if (!raw) return;
      const json = JSON.parse(raw);
      extractJsonLdNodes(json).forEach((node) => {
        const type = node['@type'];
        const types = Array.isArray(type) ? type : type ? [type] : [];
        const isOrg = types.some((x) => /organization|localbusiness|store|restaurant/i.test(x));
        if (isOrg && node.name) aggregate.jsonLdNames.push(String(node.name));
        if (node.email) addEmail(node.email);
        if (node.telephone) {
          const telList = Array.isArray(node.telephone) ? node.telephone : [node.telephone];
          telList.forEach((tel) => addPhone(String(tel), 4, 'jsonld'));
        }
      });
    } catch {
      /* skip malformed JSON-LD */
    }
  });

  return {
    text,
    textLength: text.replace(/\s+/g, ' ').trim().length,
    likelyPageUrls: getLikelyPageUrls($, baseUrl),
    title: t,
  };
}

function aggregateToExtracted(aggregate, baseUrl) {
  const emails = [...aggregate.emailSet];
  const sortedPhoneCandidates = [...aggregate.phoneScores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([phone]) => aggregate.phoneMetadata.get(phone))
    .filter(Boolean)
    .map((candidate) => ({
      ...candidate,
      confidence: getPhoneCandidateConfidence(candidate),
      kept: shouldKeepPhoneCandidate(candidate),
    }));

  const phones = sortedPhoneCandidates
    .filter((c) => c.kept)
    .slice(0, 5)
    .map((c) => c.phone);

  return {
    emails,
    phoneCandidates: sortedPhoneCandidates,
    phones,
    socials: {
      Instagram: [...new Set(aggregate.socials.Instagram)],
      Facebook: [...new Set(aggregate.socials.Facebook)],
      YouTube: [...new Set(aggregate.socials.YouTube)],
      LinkedIn: [...new Set(aggregate.socials.LinkedIn)],
    },
    jsonLdNames: [...new Set(aggregate.jsonLdNames)],
    metaDescription: aggregate.metaDescription,
    ogSiteName: aggregate.ogSiteName,
    titles: aggregate.titles,
    host: new URL(baseUrl).hostname.replace(/^www\./, ''),
  };
}

function appShellLikely(html) {
  if (!html || typeof html !== 'string') return false;
  const lower = html.slice(0, 80_000).toLowerCase();
  if (
    lower.includes('id="root"') ||
    lower.includes("id='root'") ||
    lower.includes('id="__next"') ||
    lower.includes('ng-app') ||
    lower.includes('data-reactroot')
  ) {
    return true;
  }
  return false;
}

module.exports = {
  createAggregate,
  collectSignalsFromHtml,
  aggregateToExtracted,
  mergeUnique,
  normalizePageUrl,
  isSameOrigin,
  getLikelyPageUrls,
  appShellLikely,
  MAX_ADDITIONAL_PAGES,
};
