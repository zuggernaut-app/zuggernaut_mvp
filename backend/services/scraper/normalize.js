'use strict';

const { SCRAPE_QUALITY, buildEmptyScrapeSuggestion } = require('../../constants/onboarding');

/** Persisted when headless scrape is policy-disabled (T0-6 SSRF). */
const HEADLESS_STATUS_DISABLED_SSRF = 'disabled_ssrf';

/**
 * @param {object | null | undefined} headlessRes
 */
function isHeadlessDisabledForSsrf(headlessRes) {
  return (
    Array.isArray(headlessRes?.blockReasons) &&
    headlessRes.blockReasons.includes('headless_disabled_ssrf')
  );
}

function socialTotal(socials) {
  if (!socials || typeof socials !== 'object') return 0;
  return Object.values(socials).reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
}

function emptySocials() {
  return { Instagram: [], Facebook: [], YouTube: [], LinkedIn: [] };
}

/**
 * @param {object | null | undefined} preview
 */
function mergeExtracted(a, b) {
  const ae = a && typeof a === 'object' ? a : null;
  const be = b && typeof b === 'object' ? b : null;
  if (!ae && !be) {
    return {
      emails: [],
      phoneCandidates: [],
      phones: [],
      socials: emptySocials(),
      jsonLdNames: [],
      metaDescription: null,
      ogSiteName: null,
      titles: [],
      host: '',
    };
  }
  const emails = [...new Set([...(ae?.emails || []), ...(be?.emails || [])])].filter(Boolean);
  const phones = [...new Set([...(ae?.phones || []), ...(be?.phones || [])])].filter(Boolean);

  const socials = emptySocials();
  for (const k of Object.keys(socials)) {
    socials[k] = [
      ...(ae?.socials?.[k] || []),
      ...(be?.socials?.[k] || []),
    ].filter(Boolean);
    socials[k] = [...new Set(socials[k])];
  }

  const jsonLdNames = [...new Set([...(ae?.jsonLdNames || []), ...(be?.jsonLdNames || [])])].filter(
    Boolean
  );

  const metaDescription =
    (be?.metaDescription && String(be.metaDescription)) ||
    (ae?.metaDescription && String(ae.metaDescription)) ||
    null;

  const ogSiteName =
    (be?.ogSiteName && String(be.ogSiteName)) ||
    (ae?.ogSiteName && String(ae.ogSiteName)) ||
    null;

  const titles = [...(ae?.titles || []), ...(be?.titles || [])];

  const phoneCandidates = mergePhoneCandidates(ae?.phoneCandidates, be?.phoneCandidates);

  const host = ae?.host || be?.host || '';

  const signalScore =
    emails.length + phones.length + socialTotal(socials) + (jsonLdNames.length > 0 ? 2 : 0);

  return {
    emails,
    phones,
    phoneCandidates,
    socials,
    jsonLdNames,
    metaDescription,
    ogSiteName,
    titles,
    host,
    signalScore,
  };
}

function mergePhoneCandidates(a, b) {
  const map = new Map();
  for (const list of [a, b]) {
    if (!Array.isArray(list)) continue;
    for (const c of list) {
      if (!c || !c.e164) continue;
      const prev = map.get(c.e164);
      if (!prev || (c.score || 0) > (prev.score || 0)) map.set(c.e164, { ...c });
    }
  }
  return [...map.values()].sort((x, y) => (y.score || 0) - (x.score || 0));
}

function pickBusinessName(merged, websiteUrl) {
  if (merged.ogSiteName) return String(merged.ogSiteName).trim();
  if (merged.jsonLdNames[0]) return String(merged.jsonLdNames[0]).trim();
  const t = merged.titles.find((x) => x && x.title && x.title.length > 2);
  if (t) {
    const title = String(t.title).replace(/\s*[|\u2013\u2014-]\s*.*$/, '').trim();
    if (title) return title;
  }
  try {
    const host = new URL(websiteUrl).hostname.replace(/^www\./, '');
    const part = host.split('.')[0] || 'business';
    return part.charAt(0).toUpperCase() + part.slice(1);
  } catch {
    return 'Your business';
  }
}

function buildContactMethods(merged) {
  const contact = {};
  if (merged.emails.length) contact.emails = merged.emails.slice(0, 3);
  if (merged.phones.length) contact.phones = merged.phones.slice(0, 3);
  const socials = {};
  for (const [k, v] of Object.entries(merged.socials || {})) {
    if (Array.isArray(v) && v.length) socials[k] = v.slice(0, 2);
  }
  if (Object.keys(socials).length) contact.socials = socials;
  return Object.keys(contact).length ? contact : null;
}

function deriveServices(merged) {
  const services = [];
  const desc = merged.metaDescription;
  if (desc) {
    const parts = desc
      .split(/[,;•|]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 3 && s.length < 80);
    services.push(...parts);
  }
  for (const entry of merged.titles || []) {
    const title = entry?.title ? String(entry.title).trim() : '';
    if (!title || title.length < 4 || title.length > 60) continue;
    const cleaned = title.replace(/\s*[|\u2013\u2014-]\s*.*$/, '').trim();
    if (cleaned && !services.includes(cleaned)) services.push(cleaned);
  }
  const unique = [...new Set(services)].slice(0, 8);
  if (unique.length) return unique;
  if (merged.signalScore > 0) return ['General services'];
  return [];
}

function deriveServiceAreas(merged, websiteUrl) {
  const areas = [];
  const desc = merged.metaDescription || '';
  const matches = [
    ...desc.matchAll(/\b(?:serving|located in|based in|service area[s]?:?)\s+([A-Za-z0-9\s,.-]{3,48})/gi),
  ];
  for (const m of matches) {
    const area = m[1]?.trim();
    if (area) areas.push(area.replace(/\.$/, ''));
  }
  if (!areas.length && merged.host) {
    areas.push(`${merged.host} area`);
  }
  if (!areas.length) {
    try {
      const host = new URL(websiteUrl).hostname.replace(/^www\./, '');
      if (host) areas.push(`${host} area`);
    } catch {
      /* skip */
    }
  }
  return [...new Set(areas)].slice(0, 5);
}

function deriveIndustry(merged) {
  const text = `${merged.metaDescription || ''} ${merged.ogSiteName || ''}`.toLowerCase();
  const hints = [
    ['plumb', 'Plumbing & HVAC'],
    ['hvac', 'Plumbing & HVAC'],
    ['dental', 'Dental & Healthcare'],
    ['clinic', 'Healthcare'],
    ['lawyer', 'Legal Services'],
    ['attorney', 'Legal Services'],
    ['restaurant', 'Food & Hospitality'],
    ['roofing', 'Home Services'],
    ['cleaning', 'Cleaning Services'],
    ['landscap', 'Landscaping'],
    ['electric', 'Electrical Services'],
  ];
  for (const [needle, label] of hints) {
    if (text.includes(needle)) return label;
  }
  return merged.signalScore > 2 ? 'Local services' : null;
}

function deriveGoals(merged, contactMethods) {
  if (!contactMethods) return null;
  const goals = { primary: 'generate_leads' };
  if (contactMethods.phones?.length) goals.preferredContact = 'phone';
  else if (contactMethods.emails?.length) goals.preferredContact = 'email';
  return goals;
}

function assessScrapeQuality(merged, status) {
  if (status === 'BLOCKED' || status === 'FAILED') return SCRAPE_QUALITY.NONE;
  if (merged.signalScore >= 4) return SCRAPE_QUALITY.STRONG;
  if (merged.signalScore > 0) return SCRAPE_QUALITY.WEAK;
  return SCRAPE_QUALITY.NONE;
}

function buildDifferentiators(merged, scrapeQuality) {
  if (merged.metaDescription) return String(merged.metaDescription).trim();
  if (scrapeQuality === SCRAPE_QUALITY.WEAK) {
    return 'Limited public signals found — review and add your differentiators manually.';
  }
  return 'Could not extract rich text from this site automatically. Enter your value proposition manually.';
}

/**
 * @param {object} input
 * @param {string} input.websiteUrl
 * @param {string} input.scrapeRunId
 * @param {string} input.startedAt
 * @param {{ allowed: boolean, reason?: string }} [input.robots]
 * @param {object | null} [input.staticResult]
 * @param {object | null} [input.headlessResult]
 */
function normalizeScrapeResult(input) {
  const websiteUrl = input.websiteUrl;
  const scrapeRunId = input.scrapeRunId;
  const startedAt = input.startedAt;
  const robots = input.robots;
  const staticRes = input.staticResult;
  const headlessRes = input.headlessResult;

  const strategies = [];
  if (staticRes) strategies.push('static');
  if (headlessRes) strategies.push('headless');

  const merged = mergeExtracted(staticRes?.extractedPreview, headlessRes?.extractedPreview);

  let status = 'SUCCEEDED';
  const warnings = [];
  const headlessDisabledSsrf = isHeadlessDisabledForSsrf(headlessRes);

  if (headlessDisabledSsrf) {
    warnings.push('headless_disabled_ssrf');
  }

  if (robots && robots.allowed === false) {
    status = 'BLOCKED';
    warnings.push('robots_disallowed');
  } else {
    const staticBlocked = !!staticRes?.blocked;
    const headBlocked = headlessRes ? !!headlessRes.blocked : false;
    const anyData = merged.signalScore > 0;

    if (!anyData && staticBlocked && (headlessRes == null || headBlocked)) {
      status = 'BLOCKED';
      warnings.push('site_blocked');
    } else if (!anyData) {
      status = 'PARTIAL';
      warnings.push('no_signals_extracted');
    } else if ((staticRes?.partialBlock || headlessRes?.partialBlock) && merged.signalScore <= 2) {
      status = 'PARTIAL';
      warnings.push('possible_waf_or_challenge');
    }
  }

  const scrapeQuality = assessScrapeQuality(merged, status);
  const contactMethods = buildContactMethods(merged);
  const emptyFallback = buildEmptyScrapeSuggestion(websiteUrl);

  const headlessStatusFields = headlessDisabledSsrf
    ? { headlessStatus: HEADLESS_STATUS_DISABLED_SSRF }
    : {};

  const suggested =
    scrapeQuality === SCRAPE_QUALITY.NONE
      ? {
          ...emptyFallback,
          businessName: pickBusinessName(merged, websiteUrl),
          differentiators: buildDifferentiators(merged, scrapeQuality),
          scrapeQuality,
          manualFallback: true,
          ...headlessStatusFields,
        }
      : {
          businessName: pickBusinessName(merged, websiteUrl),
          industry: deriveIndustry(merged),
          services: deriveServices(merged),
          serviceAreas: deriveServiceAreas(merged, websiteUrl),
          contactMethods,
          goals: deriveGoals(merged, contactMethods),
          differentiators: buildDifferentiators(merged, scrapeQuality),
          orderValueHint: merged.signalScore >= 4 ? 'medium' : 'unknown',
          scrapeQuality,
          manualFallback: false,
          ...headlessStatusFields,
        };

  const rawPayload = {
    source: 'enterprise_scraper_v1',
    schemaVersion: 2,
    scrapeRunId,
    websiteUrl,
    status,
    startedAt,
    completedAt: new Date().toISOString(),
    strategies,
    robots: robots || undefined,
    pages: [...(staticRes?.pages || []), ...(headlessRes?.pages || [])],
    extracted: merged,
    suggested,
    warnings,
    errors: [...(staticRes?.errors || []), ...(headlessRes?.errors || [])],
    diagnostics: {
      robots: robots?.reason || 'ok',
      staticBlocked: !!staticRes?.blocked,
      headlessBlocked: headlessRes ? !!headlessRes.blocked : false,
      ...(headlessDisabledSsrf ? { headlessStatus: HEADLESS_STATUS_DISABLED_SSRF } : {}),
      signalScore: merged.signalScore,
      scrapeQuality,
    },
    ...(headlessDisabledSsrf ? { headlessStatus: HEADLESS_STATUS_DISABLED_SSRF } : {}),
  };

  return { status, suggested, rawPayload };
}

module.exports = { normalizeScrapeResult, mergeExtracted };
