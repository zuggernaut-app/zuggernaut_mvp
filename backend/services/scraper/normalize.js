'use strict';

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
  if (merged.ogSiteName) return String(merged.ogSiteName);
  if (merged.jsonLdNames[0]) return String(merged.jsonLdNames[0]);
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

function deriveServicesHint(merged) {
  if (merged.signalScore > 0) {
    const base = ['Core service offering', 'Consultation'];
    return base;
  }
  return ['—'];
}

function deriveAreasHint(merged) {
  return merged.signalScore > 0 ? ['Service area TBD'] : ['—'];
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

  if (robots && robots.allowed === false) {
    status = 'BLOCKED';
  } else {
    const staticBlocked = !!staticRes?.blocked;
    const headBlocked = headlessRes ? !!headlessRes.blocked : false;
    const anyData = merged.signalScore > 0;

    if (!anyData && staticBlocked && (headlessRes == null || headBlocked)) {
      status = 'BLOCKED';
    } else if (!anyData) {
      status = 'PARTIAL';
      warnings.push('no_signals_extracted');
    } else if ((staticRes?.partialBlock || headlessRes?.partialBlock) && merged.signalScore <= 2) {
      status = 'PARTIAL';
      warnings.push('possible_waf_or_challenge');
    }
  }

  const businessName = `${pickBusinessName(merged, websiteUrl)} (draft from website)`;

  const suggested = {
    businessName,
    industry: 'Local services',
    services: deriveServicesHint(merged),
    serviceAreas: deriveAreasHint(merged),
    differentiators:
      merged.metaDescription ||
      (merged.signalScore > 0
        ? 'Extracted from public site content.'
        : 'Could not extract rich text from this site automatically.'),
    orderValueHint: 'unknown',
  };

  const rawPayload = {
    source: 'enterprise_scraper_v1',
    schemaVersion: 1,
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
      signalScore: merged.signalScore,
    },
  };

  return { status, suggested, rawPayload };
}

module.exports = { normalizeScrapeResult, mergeExtracted };
