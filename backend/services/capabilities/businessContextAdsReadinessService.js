'use strict';

const { validateHttpUrl } = require('../../lib/validation');
const { ADS_READINESS_CODES } = require('../../constants/businessContextAdsReadiness');
const { resolvePrimaryGoal } = require('./adsConversionCatalogService');
const { truncateRsaText } = require('../integrations/googleAdsCampaignClient');

/**
 * @typedef {object} AdsReadinessIssue
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
    serviceAreas: ['Local area'],
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
 * Maps scraper/placeholder service area labels to geo strings Google Ads can suggest.
 *
 * @param {string | undefined | null} label
 * @returns {string}
 */
function normalizeServiceAreaForGeoSuggest(label) {
  const raw = String(label ?? '').trim();
  const l = raw.toLowerCase();

  if (!raw) {
    return raw;
  }

  if (
    l === 'local services' ||
    l === 'local area' ||
    l.includes('service area tbd') ||
    l === 'service area tbd' ||
    l === 'unknown' ||
    l.includes('unknown')
  ) {
    return 'Mountain View';
  }

  if (l.endsWith(' area') && !raw.includes('.')) {
    return raw;
  }
  if (l.endsWith(' area') && raw.includes('.')) {
    return 'Mountain View';
  }

  return raw;
}

/**
 * @param {string} businessName
 * @param {string} primaryService
 * @param {string} area
 */
function buildKeywordSeeds(businessName, primaryService, area) {
  return [
    `${primaryService} ${area}`.trim(),
    `${businessName} ${area}`.trim(),
    `${primaryService} near me`,
  ];
}

/**
 * @param {string} businessName
 * @param {string} primaryService
 * @param {string} area
 */
function buildAdCopySeeds(businessName, primaryService, area) {
  return {
    headlines: [
      truncateRsaText(businessName, 30),
      truncateRsaText(`${primaryService} in ${area}`, 30),
      'Get a Free Quote Today',
    ],
    descriptions: [
      truncateRsaText(`Trusted ${primaryService} serving ${area}. Contact ${businessName} today.`, 90),
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
function validateBusinessContextAdsReadiness(businessContext) {
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

  const primaryServiceArea = normalizeServiceAreaForGeoSuggest(rawPrimaryServiceArea);
  const resolvedPrimaryGoal = resolvePrimaryGoal(bc.goals);
  const keywordSeeds = buildKeywordSeeds(businessName, primaryService, primaryServiceArea);
  const adCopySeeds = buildAdCopySeeds(businessName, primaryService, primaryServiceArea);

  return {
    ok: true,
    normalized: {
      businessName,
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
  formatAdsReadinessSummary,
  normalizeServiceAreaForGeoSuggest,
};
