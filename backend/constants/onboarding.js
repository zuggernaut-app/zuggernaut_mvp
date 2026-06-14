'use strict';

/**
 * Phase 4 MVP contract — canonical BusinessContext fields confirmed by the user.
 * Raw scrape output must never populate these without an explicit PUT.
 * @see mvp_implementation_plan.md → Phase 4 / Block 1
 */
const BUSINESS_CONTEXT_MVP_FIELDS = Object.freeze([
  'websiteUrl',
  'businessName',
  'industry',
  'services',
  'serviceAreas',
  'contactMethods',
  'goals',
  'differentiators',
  'orderValueHint',
]);

/** Minimum user-confirmed fields before setup may start. */
const BUSINESS_CONTEXT_CONFIRM_REQUIRED = Object.freeze(['businessName']);

const SCRAPE_TERMINAL_STATUSES = Object.freeze([
  'SUCCEEDED',
  'PARTIAL',
  'BLOCKED',
  'FAILED',
]);

const SCRAPE_QUALITY = Object.freeze({
  STRONG: 'strong',
  WEAK: 'weak',
  NONE: 'none',
});

/**
 * Empty suggestion payload when scrape fails or user enters details manually.
 * @param {string} websiteUrl
 */
function buildEmptyScrapeSuggestion(websiteUrl) {
  let businessName = 'Your business';
  try {
    const host = new URL(websiteUrl).hostname.replace(/^www\./, '');
    const part = host.split('.')[0] || 'business';
    businessName = part.charAt(0).toUpperCase() + part.slice(1);
  } catch {
    /* keep default */
  }

  return {
    businessName,
    industry: null,
    services: [],
    serviceAreas: [],
    contactMethods: null,
    goals: null,
    differentiators: null,
    orderValueHint: null,
    scrapeQuality: SCRAPE_QUALITY.NONE,
    manualFallback: true,
  };
}

module.exports = {
  BUSINESS_CONTEXT_MVP_FIELDS,
  BUSINESS_CONTEXT_CONFIRM_REQUIRED,
  SCRAPE_TERMINAL_STATUSES,
  SCRAPE_QUALITY,
  buildEmptyScrapeSuggestion,
};
