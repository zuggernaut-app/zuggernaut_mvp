'use strict';

const cheerio = require('cheerio');
const {
  parseInternationalPhone,
  extractPhonesFromText,
  inferDefaultCountryFromUrl,
} = require('./phoneUtils');

const { SCRAPE_MAX_PAGES } = require('../../constants/leadCampaign');

/** Homepage counts as one page; additional fetches are capped at SCRAPE_MAX_PAGES - 1. */
const MAX_ADDITIONAL_PAGES = Math.max(0, SCRAPE_MAX_PAGES - 1);

/** Fetch-priority tiers (higher = fetched earlier). */
const FETCH_TIER = {
  CONTACT: 6,
  LOCATION: 5,
  SERVICES_PRODUCTS: 4,
  ABOUT: 3,
  MAIN_MENU: 2,
  OTHER: 1,
};

const MENU_PARENT_SELECTOR =
  'nav, [role="navigation"], header nav, .main-menu, .menu, #menu, [class*="main-nav"], [class*="primary-nav"]';
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

/**
 * @param {string} pageUrl
 * @param {string} baseUrl
 * @param {{ inMainMenu?: boolean, href?: string, linkText?: string }} [ctx]
 */
function getPageFetchPriority(pageUrl, baseUrl, ctx = {}) {
  if (pageUrl === baseUrl) return FETCH_TIER.CONTACT + 1;
  const pathName = new URL(pageUrl).pathname.toLowerCase();
  const haystack = `${pathName} ${ctx.href || ''} ${ctx.linkText || ''}`.toLowerCase();

  if (pathName.includes('contact') || /\bcontact\b/.test(haystack)) return FETCH_TIER.CONTACT;
  if (
    pathName.includes('location') ||
    pathName.includes('service-area') ||
    /\blocation\b|\bservice area/.test(haystack)
  ) {
    return FETCH_TIER.LOCATION;
  }
  if (
    /service|product|pricing|shop|store/.test(pathName) ||
    /\bservices\b|\bproducts\b/.test(haystack)
  ) {
    return FETCH_TIER.SERVICES_PRODUCTS;
  }
  if (pathName.includes('about') || /\babout\b/.test(haystack)) return FETCH_TIER.ABOUT;
  if (ctx.inMainMenu) return FETCH_TIER.MAIN_MENU;
  return FETCH_TIER.OTHER;
}

/** Legacy phone-signal weighting from path (0–3). */
function getPageBoost(pageUrl, baseUrl) {
  const tier = getPageFetchPriority(pageUrl, baseUrl);
  if (tier >= FETCH_TIER.CONTACT) return 3;
  if (tier >= FETCH_TIER.LOCATION) return 2;
  if (tier >= FETCH_TIER.ABOUT) return 1;
  return 0;
}

function linkInMainMenu($, el) {
  const parents = $(el).parents(MENU_PARENT_SELECTOR);
  return parents.length > 0;
}

function getLikelyPageUrls($, baseUrl) {
  const normalizedBaseUrl = normalizePageUrl(baseUrl, baseUrl);
  const priorityByUrl = new Map();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const linkText = $(el).text().trim();
    const normalized = normalizePageUrl(href, baseUrl);
    if (!normalized || normalized === normalizedBaseUrl || !isSameOrigin(normalized, baseUrl)) {
      return;
    }
    const tier = getPageFetchPriority(normalized, baseUrl, {
      inMainMenu: linkInMainMenu($, el),
      href: href || '',
      linkText,
    });
    const prev = priorityByUrl.get(normalized) || 0;
    if (tier > prev) priorityByUrl.set(normalized, tier);
  });

  return [...priorityByUrl.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => url)
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
  getPageFetchPriority,
  FETCH_TIER,
  appShellLikely,
  MAX_ADDITIONAL_PAGES,
};
