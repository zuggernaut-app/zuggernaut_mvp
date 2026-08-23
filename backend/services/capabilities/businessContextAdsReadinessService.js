'use strict';

const mongoose = require('mongoose');
const { validateHttpUrl } = require('../../lib/validation');
const { ADS_READINESS_CODES } = require('../../constants/businessContextAdsReadiness');
const { SCRAPE_RUN_STATUS } = require('../../constants/enums');
const { resolvePrimaryGoal } = require('./adsConversionCatalogService');
const { truncateRsaText } = require('../integrations/googleAdsCampaignClient');

/** Max length for business name used in Ads copy (before RSA field limits). */
const BUSINESS_NAME_FOR_ADS_MAX_CHARS = 50;

/**
 * Cleans scraped/structured business names for Ads copy and keywords.
 * Takes the first comma-separated segment, strips special characters, caps length.
 *
 * @param {string | null | undefined} businessName
 * @returns {string}
 */
function normalizeBusinessNameForAds(businessName) {
  const raw = String(businessName ?? '').trim();
  if (!raw) {
    return '';
  }

  const primarySegment = raw.includes(',') ? raw.split(',')[0].trim() : raw;
  const cleaned = primarySegment
    .replace(/[^a-zA-Z0-9\s'-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return '';
  }

  return cleaned.length <= BUSINESS_NAME_FOR_ADS_MAX_CHARS
    ? cleaned
    : cleaned.slice(0, BUSINESS_NAME_FOR_ADS_MAX_CHARS).trim();
}

/**
 * @typedef {object} AdsReadinessIssue
 * @property {string} code
 * @property {string} field
 * @property {string} message
 */

/**
 * @typedef {object} AdsReadinessWarning
 * @property {string} code
 * @property {string} field
 * @property {string} message
 */

/**
 * @typedef {object} AdsReadinessNormalized
 * @property {string} businessName
 * @property {string} websiteUrl
 * @property {string} primaryService
 * @property {string} primaryServiceArea
 * @property {string[]} services
 * @property {string[]} serviceAreas
 * @property {'calls'|'forms'|'both'} resolvedPrimaryGoal
 * @property {string[]} keywordSeeds
 * @property {{ headlines: string[], descriptions: string[] }} adCopySeeds
 */

/**
 * Minimal confirmed BusinessContext fields that satisfy Ads readiness (tests/fixtures).
 *
 * @param {object} [overrides]
 */
function buildMinimalAdsReadyBusinessContext(overrides = {}) {
  return {
    businessName: 'Test Business',
    websiteUrl: 'https://example.com',
    industry: 'services',
    services: ['Example service'],
    serviceAreas: ['San Francisco'],
    goals: { primary: 'both' },
    ...overrides,
  };
}

/**
 * @param {string} code
 * @param {string} field
 * @param {string} message
 * @returns {AdsReadinessIssue}
 */
function issue(code, field, message) {
  return { code, field, message };
}

/**
 * @param {object | null | undefined} goals
 */
function goalsPrimaryIsPresent(goals) {
  if (goals == null || typeof goals !== 'object' || Array.isArray(goals)) {
    return false;
  }
  const primary = goals.primary;
  return typeof primary === 'string' && primary.trim().length > 0;
}

/**
 * @param {object | null | undefined} goals
 */
function goalsPrimaryIsSupported(goals) {
  if (!goalsPrimaryIsPresent(goals)) {
    return false;
  }
  const raw = String(goals.primary).trim().toLowerCase();
  const supported = new Set(['calls', 'call', 'forms', 'form', 'leads', 'lead', 'both']);
  return supported.has(raw);
}

/**
 * Detects scraper/placeholder service area labels that are not valid geo targets.
 *
 * @param {string | undefined | null} label
 * @returns {boolean}
 */
function isPlaceholderServiceArea(label) {
  const raw = String(label ?? '').trim();
  const l = raw.toLowerCase();

  if (!raw) {
    return false;
  }

  if (
    l === 'local services' ||
    l === 'local area' ||
    l.includes('service area tbd') ||
    l === 'service area tbd' ||
    l === 'unknown' ||
    l.includes('unknown')
  ) {
    return true;
  }

  if (l.endsWith(' area') && raw.includes('.')) {
    return true;
  }

  return false;
}

/**
 * @param {string} businessName
 * @param {string} primaryService
 * @param {string} area
 */
function buildKeywordSeeds(businessName, primaryService, area) {
  const cleanName = normalizeBusinessNameForAds(businessName);
  return [
    `${primaryService} ${area}`.trim(),
    `${cleanName} ${area}`.trim(),
    `${primaryService} near me`,
  ];
}

/**
 * @param {string} businessName
 * @param {string} primaryService
 * @param {string} area
 */
function buildAdCopySeeds(businessName, primaryService, area) {
  const cleanName = normalizeBusinessNameForAds(businessName);
  return {
    headlines: [
      truncateRsaText(cleanName, 30),
      truncateRsaText(`${primaryService} in ${area}`, 30),
      'Get a Free Quote Today',
    ],
    descriptions: [
      truncateRsaText(`Trusted ${primaryService} serving ${area}. Contact ${cleanName} today.`, 90),
      truncateRsaText(`Professional ${primaryService}. Visit our website to learn more.`, 90),
    ],
  };
}

/**
 * Validates confirmed BusinessContext inputs required for Google Ads campaign creation.
 *
 * @param {object | null | undefined} businessContext — lean BusinessContext
 * @returns {{ ok: true, normalized: AdsReadinessNormalized } | { ok: false, issues: AdsReadinessIssue[] }}
 */
function validateBusinessContextAdsReadinessSync(businessContext) {
  const issues = [];
  const bc = businessContext ?? {};

  const businessName = typeof bc.businessName === 'string' ? bc.businessName.trim() : '';
  if (!businessName) {
    issues.push(
      issue(
        ADS_READINESS_CODES.MISSING_BUSINESS_NAME,
        'businessName',
        'Business name is required before Google Ads setup can start.'
      )
    );
  }

  const websiteRaw = typeof bc.websiteUrl === 'string' ? bc.websiteUrl : '';
  if (!websiteRaw.trim()) {
    issues.push(
      issue(
        ADS_READINESS_CODES.MISSING_WEBSITE_URL,
        'websiteUrl',
        'Website URL is required before Google Ads setup can start.'
      )
    );
  }

  let websiteUrl = '';
  if (websiteRaw.trim()) {
    const urlCheck = validateHttpUrl(websiteRaw);
    if (!urlCheck.ok) {
      issues.push(
        issue(
          ADS_READINESS_CODES.INVALID_WEBSITE_URL,
          'websiteUrl',
          urlCheck.message ?? 'Website URL must be a valid http or https URL.'
        )
      );
    } else {
      websiteUrl = urlCheck.value;
    }
  }

  const services = Array.isArray(bc.services)
    ? bc.services.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const industry = typeof bc.industry === 'string' ? bc.industry.trim() : '';
  const primaryService = services[0] ?? industry;

  if (!primaryService) {
    issues.push(
      issue(
        ADS_READINESS_CODES.MISSING_SERVICES,
        'services',
        'Add at least one service or an industry before Google Ads setup can start.'
      )
    );
  }

  const serviceAreas = Array.isArray(bc.serviceAreas)
    ? bc.serviceAreas.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const rawPrimaryServiceArea = serviceAreas[0] ?? '';

  if (!rawPrimaryServiceArea) {
    issues.push(
      issue(
        ADS_READINESS_CODES.MISSING_SERVICE_AREAS,
        'serviceAreas',
        'Add at least one service area before Google Ads setup can start.'
      )
    );
  } else if (isPlaceholderServiceArea(rawPrimaryServiceArea)) {
    issues.push(
      issue(
        ADS_READINESS_CODES.PLACEHOLDER_SERVICE_AREA,
        'serviceAreas',
        'Confirm a real city or region for your service area before Google Ads setup can start.'
      )
    );
  }

  if (!goalsPrimaryIsPresent(bc.goals)) {
    issues.push(
      issue(
        ADS_READINESS_CODES.MISSING_GOALS,
        'goals',
        'Choose a primary business goal (calls, forms, or both) before Google Ads setup can start.'
      )
    );
  } else if (!goalsPrimaryIsSupported(bc.goals)) {
    issues.push(
      issue(
        ADS_READINESS_CODES.UNSUPPORTED_GOAL,
        'goals',
        'Primary business goal must be calls, forms, or both.'
      )
    );
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }

  const primaryServiceArea = rawPrimaryServiceArea;
  const resolvedPrimaryGoal = resolvePrimaryGoal(bc.goals);
  const adsBusinessName = normalizeBusinessNameForAds(businessName);
  if (!adsBusinessName) {
    return {
      ok: false,
      issues: [
        issue(
          ADS_READINESS_CODES.MISSING_BUSINESS_NAME,
          'businessName',
          'Business name must contain readable characters for Google Ads copy.'
        ),
      ],
    };
  }

  const keywordSeeds = buildKeywordSeeds(adsBusinessName, primaryService, primaryServiceArea);
  const adCopySeeds = buildAdCopySeeds(adsBusinessName, primaryService, primaryServiceArea);

  return {
    ok: true,
    normalized: {
      businessName: adsBusinessName,
      websiteUrl,
      primaryService,
      primaryServiceArea,
      services,
      serviceAreas,
      resolvedPrimaryGoal,
      keywordSeeds,
      adCopySeeds,
    },
  };
}

const TERMINAL_SCRAPE_STATUSES = Object.freeze(
  SCRAPE_RUN_STATUS.filter((status) => status !== 'QUEUED' && status !== 'RUNNING')
);

/**
 * Read headless scrape policy from the latest terminal ScrapeRun for this business.
 *
 * @param {import('mongoose').Types.ObjectId | string | null | undefined} businessId
 * @returns {Promise<'disabled_ssrf' | null>}
 */
async function resolveHeadlessStatusFromLatestScrape(businessId) {
  if (!businessId) return null;

  const ScrapeRun = mongoose.model('ScrapeRun');
  let run;
  try {
    run = await ScrapeRun.findOne({
      businessId,
      status: { $in: TERMINAL_SCRAPE_STATUSES },
    })
      .sort({ updatedAt: -1 })
      .select('resultSuggested')
      .lean();
  } catch {
    return null;
  }

  const suggested = run?.resultSuggested;
  if (!suggested || typeof suggested !== 'object') return null;

  if (suggested.headlessStatus === 'disabled_ssrf') return 'disabled_ssrf';
  if (
    Array.isArray(suggested.warnings) &&
    suggested.warnings.includes('headless_disabled_ssrf')
  ) {
    return 'disabled_ssrf';
  }

  return null;
}

/**
 * @param {{ ok: true, normalized: AdsReadinessNormalized } | { ok: false, issues: AdsReadinessIssue[] }} result
 * @param {'disabled_ssrf' | null} headlessStatus
 */
function attachScrapeCompletenessWarnings(result, headlessStatus) {
  if (!result.ok || headlessStatus !== 'disabled_ssrf') return result;

  const warnings = [
    issue(
      ADS_READINESS_CODES.HEADLESS_DISABLED_SSRF,
      'scrape',
      'Onboarding used static scraping only; headless browsing was disabled for security. Review business details manually if the site relies on heavy JavaScript.'
    ),
  ];

  return { ...result, warnings };
}

/**
 * Validates confirmed BusinessContext inputs required for Google Ads campaign creation.
 * When scrape used static-only (headless disabled for SSRF), attaches a non-blocking warning.
 *
 * @param {object | null | undefined} businessContext — lean BusinessContext
 * @returns {Promise<
 *   { ok: true, normalized: AdsReadinessNormalized, warnings?: AdsReadinessWarning[] }
 *   | { ok: false, issues: AdsReadinessIssue[] }
 * >}
 */
async function validateBusinessContextAdsReadiness(businessContext) {
  const result = validateBusinessContextAdsReadinessSync(businessContext);
  if (!result.ok) return result;

  const headlessStatus = await resolveHeadlessStatusFromLatestScrape(businessContext?.businessId);
  return attachScrapeCompletenessWarnings(result, headlessStatus);
}

/**
 * @param {{ ok: false, issues: AdsReadinessIssue[] }} result
 */
function formatAdsReadinessSummary(result) {
  if (result.ok || !Array.isArray(result.issues) || result.issues.length < 1) {
    return 'Business context is not ready for Google Ads setup.';
  }
  return result.issues[0].message;
}

module.exports = {
  buildMinimalAdsReadyBusinessContext,
  validateBusinessContextAdsReadiness,
  validateBusinessContextAdsReadinessSync,
  resolveHeadlessStatusFromLatestScrape,
  attachScrapeCompletenessWarnings,
  formatAdsReadinessSummary,
  isPlaceholderServiceArea,
  normalizeBusinessNameForAds,
  buildAdCopySeeds,
  buildKeywordSeeds,
};
