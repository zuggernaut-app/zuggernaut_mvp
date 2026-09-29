'use strict';

/** Answer provenance for intake and operator-confirmed facts. */
const INTAKE_FIELD_SOURCES = Object.freeze(['customer', 'operator', 'ai_guess']);

/** Managed MVP campaign slots (cap applies to these only). */
const LEAD_CAMPAIGN_SLOTS = Object.freeze(['recommended', 'alternative']);

const SUPPORTED_ACCOUNT_CURRENCIES = Object.freeze(['USD', 'INR']);

/** Daily floor per campaign in account currency minor units (micros for USD; paise-equivalent scale for INR). */
const FLOOR_DAILY_MICROS = Object.freeze({
  USD: 5_000_000,
  INR: 400_000_000,
});

/** Combined daily ceiling per plan tier in account currency micros. */
const PLAN_CEILING_DAILY_MICROS = Object.freeze({
  starter: { USD: 10_000_000, INR: 800_000_000 },
  middle: { USD: 25_000_000, INR: 2_000_000_000 },
  top: { USD: 50_000_000, INR: 4_000_000_000 },
});

/** Operator send-back reason codes for campaign review. */
const CAMPAIGN_SEND_BACK_REASONS = Object.freeze([
  'offer_not_clear',
  'place_not_clear',
  'wrong_action',
  'page_mismatch',
  'proof_line_weak',
  'ad_copy_off_brand',
  'other',
]);

const DEFAULT_FORWARDING_COUNTRIES = Object.freeze(['US', 'IN']);

function parseForwardingCountries() {
  const raw = process.env.LEAD_CAMPAIGN_FORWARDING_COUNTRIES;
  if (!raw || !String(raw).trim()) {
    return [...DEFAULT_FORWARDING_COUNTRIES];
  }
  return String(raw)
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
}

/** Bounded whole-site crawl page cap (homepage + additional same-origin pages). */
function resolveScrapeMaxPages() {
  const parsed = Number(process.env.SCRAPE_MAX_PAGES);
  if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 100) {
    return Math.floor(parsed);
  }
  return 15;
}

const SCRAPE_MAX_PAGES = resolveScrapeMaxPages();

module.exports = {
  INTAKE_FIELD_SOURCES,
  LEAD_CAMPAIGN_SLOTS,
  SUPPORTED_ACCOUNT_CURRENCIES,
  FLOOR_DAILY_MICROS,
  PLAN_CEILING_DAILY_MICROS,
  CAMPAIGN_SEND_BACK_REASONS,
  DEFAULT_FORWARDING_COUNTRIES,
  parseForwardingCountries,
  SCRAPE_MAX_PAGES,
};
