'use strict';

const { runStaticScrape, normalizeStartUrl } = require('../scraper/staticScraper');
const { validateHttpUrl, MAX_SINGLE_LINE_FIELD } = require('../../lib/validation');
const {
  normalizeSignupAccountCurrency,
  isIsoCountryCode,
} = require('../../constants/signupAccount');
const {
  prepareSignupScrapeForWebsiteUrlChange,
  startSignupScrape,
} = require('../capabilities/leadCampaignScrapeService');
const { createLogger } = require('../../lib/observability/logger');

const logger = createLogger({ name: 'customerSignupDetails' });

const WEBSITE_INVALID_MESSAGE = 'please enter valid website details';

/**
 * @param {object} scrapeResult
 */
function staticScrapeIndicatesWebsiteOpens(scrapeResult) {
  if (!scrapeResult || !Array.isArray(scrapeResult.pages) || scrapeResult.pages.length === 0) {
    return false;
  }
  const home = scrapeResult.pages[0];
  if (typeof home?.status !== 'number' || home.status >= 400) {
    return false;
  }
  const reasons = Array.isArray(scrapeResult.blockReasons) ? scrapeResult.blockReasons : [];
  if (reasons.includes('ssrf_blocked') || reasons.includes('fetch_failed')) {
    return false;
  }
  return true;
}

/**
 * @param {unknown} raw
 */
function parseOptionalCountry(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, value: undefined };
  }
  if (typeof raw !== 'string') {
    return { ok: false, message: 'businessCountry must be a string' };
  }
  const code = raw.trim().toUpperCase();
  if (!isIsoCountryCode(code)) {
    return { ok: false, message: 'A valid business country is required' };
  }
  return { ok: true, value: code };
}

/**
 * @param {unknown} raw
 */
function parseOptionalStringField(raw, fieldName) {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, value: undefined };
  }
  if (typeof raw !== 'string') {
    return { ok: false, message: `${fieldName} must be a string` };
  }
  const t = raw.trim();
  if (t.length > MAX_SINGLE_LINE_FIELD) {
    return {
      ok: false,
      message: `${fieldName} must be at most ${MAX_SINGLE_LINE_FIELD} characters`,
    };
  }
  return { ok: true, value: t };
}

/**
 * @param {unknown} raw
 */
function parseWhatYouSell(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, value: [] };
  }
  if (typeof raw !== 'string') {
    return { ok: false, message: 'whatYouSell must be a string' };
  }
  const parts = raw
    .split(/[,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 50);
  for (const part of parts) {
    if (part.length > MAX_SINGLE_LINE_FIELD) {
      return {
        ok: false,
        message: `whatYouSell entries must be at most ${MAX_SINGLE_LINE_FIELD} characters`,
      };
    }
  }
  return { ok: true, value: parts };
}

/**
 * @param {unknown} raw
 */
function parseWhereTheyServe(raw) {
  if (raw === null || raw === undefined || raw === '') {
    return { ok: true, value: [] };
  }
  if (typeof raw !== 'string') {
    return { ok: false, message: 'whereTheyServe must be a string' };
  }
  const parts = raw
    .split(/[,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .slice(0, 50);
  return { ok: true, value: parts };
}

/**
 * @param {import('mongoose').Document} doc
 * @param {import('mongoose').Types.ObjectId | string} userId
 * @param {object} body
 */
async function completeCustomerSignupDetails(doc, userId, body) {
  const businessName =
    typeof body?.businessName === 'string' ? body.businessName.trim() : '';
  if (!businessName) {
    return { ok: false, message: 'Business name is required' };
  }
  if (businessName.length > MAX_SINGLE_LINE_FIELD) {
    return {
      ok: false,
      message: `businessName must be at most ${MAX_SINGLE_LINE_FIELD} characters`,
    };
  }

  const hasNoWebsite = body?.hasNoWebsite === true;

  if (body?.termsAccepted !== true) {
    return { ok: false, message: 'You must accept the terms and conditions' };
  }

  const countryParsed = parseOptionalCountry(body?.businessCountry);
  if (!countryParsed.ok) return countryParsed;

  const currencyCode = normalizeSignupAccountCurrency(body?.accountCurrencyCode);
  const accountCurrencyCode = currencyCode || 'USD';

  const timeZoneParsed = parseOptionalStringField(body?.accountTimeZone, 'accountTimeZone');
  if (!timeZoneParsed.ok) return timeZoneParsed;

  const whoBuysParsed = parseOptionalStringField(body?.whoBuysToday, 'whoBuysToday');
  if (!whoBuysParsed.ok) return whoBuysParsed;

  const contactParsed = parseOptionalStringField(body?.howBuyersContact, 'howBuyersContact');
  if (!contactParsed.ok) return contactParsed;

  const orderValueParsed = parseOptionalStringField(body?.orderValueHint, 'orderValueHint');
  if (!orderValueParsed.ok) return orderValueParsed;

  const sellParsed = parseWhatYouSell(body?.whatYouSell);
  if (!sellParsed.ok) return sellParsed;

  const serveParsed = parseWhereTheyServe(body?.whereTheyServe);
  if (!serveParsed.ok) return serveParsed;

  let normalizedWebsite;
  if (!hasNoWebsite) {
    const websiteRaw = typeof body?.websiteUrl === 'string' ? body.websiteUrl.trim() : '';
    if (!websiteRaw) {
      return { ok: false, message: 'websiteUrl is required', field: 'websiteUrl' };
    }
    const urlCheck = validateHttpUrl(websiteRaw);
    if (!urlCheck.ok) {
      return { ok: false, message: urlCheck.message, field: 'websiteUrl' };
    }

    normalizedWebsite = normalizeStartUrl(urlCheck.value);

    let scrapeResult;
    try {
      scrapeResult = await runStaticScrape(normalizedWebsite);
    } catch (err) {
      logger.warn(
        {
          businessId: String(doc.businessId),
          errName: err?.name,
          errMessage: typeof err?.message === 'string' ? err.message.slice(0, 200) : undefined,
        },
        'customer_signup_details_website_probe_failed',
      );
      return { ok: false, message: WEBSITE_INVALID_MESSAGE, field: 'websiteUrl' };
    }

    if (!staticScrapeIndicatesWebsiteOpens(scrapeResult)) {
      return { ok: false, message: WEBSITE_INVALID_MESSAGE, field: 'websiteUrl' };
    }
  }

  const previousWebsite =
    typeof doc.websiteUrl === 'string' && doc.websiteUrl.trim()
      ? normalizeStartUrl(doc.websiteUrl)
      : '';

  const now = new Date();
  const intakeFieldSources = {
    ...(doc.intakeFieldSources && typeof doc.intakeFieldSources === 'object'
      ? doc.intakeFieldSources
      : {}),
    businessName: 'customer',
    termsAcceptedAt: 'customer',
    ...(countryParsed.value ? { businessCountry: 'customer' } : {}),
    accountCurrencyCode: 'customer',
    ...(timeZoneParsed.value ? { accountTimeZone: 'customer' } : {}),
    ...(sellParsed.value.length > 0 ? { services: 'customer' } : {}),
    ...(serveParsed.value.length > 0 ? { serviceAreas: 'customer' } : {}),
    ...(whoBuysParsed.value ? { whoBuysToday: 'customer' } : {}),
    ...(contactParsed.value ? { howBuyersContact: 'customer' } : {}),
    ...(orderValueParsed.value ? { orderValueHint: 'customer' } : {}),
  };

  doc.businessName = businessName;
  doc.businessCountry = countryParsed.value;
  doc.accountCurrencyCode = accountCurrencyCode;
  doc.accountTimeZone = timeZoneParsed.value;
  doc.services = sellParsed.value;
  doc.serviceAreas = serveParsed.value;
  doc.whoBuysToday = whoBuysParsed.value;
  doc.howBuyersContact = contactParsed.value;
  doc.orderValueHint = orderValueParsed.value;
  doc.termsAcceptedAt = now;
  doc.signupCompletedAt = now;
  doc.intakeFieldSources = intakeFieldSources;

  if (hasNoWebsite) {
    doc.websiteUrl = undefined;
  } else {
    doc.websiteUrl = normalizedWebsite;
    intakeFieldSources.websiteUrl = 'customer';
  }

  await doc.save();

  if (!hasNoWebsite && normalizedWebsite) {
    if (previousWebsite && previousWebsite !== normalizedWebsite) {
      await prepareSignupScrapeForWebsiteUrlChange({
        businessId: doc.businessId,
        previousWebsiteUrl: previousWebsite,
        nextWebsiteUrl: normalizedWebsite,
      });
    }

    try {
      await startSignupScrape(doc.businessId, userId, normalizedWebsite);
    } catch (err) {
      logger.warn(
        {
          businessId: String(doc.businessId),
          errName: err?.name,
          errCode: err?.code,
          errMessage: typeof err?.message === 'string' ? err.message.slice(0, 200) : undefined,
        },
        'customer_signup_details_scrape_start_failed',
      );
    }
  }

  return { ok: true, doc };
}

module.exports = {
  WEBSITE_INVALID_MESSAGE,
  staticScrapeIndicatesWebsiteOpens,
  completeCustomerSignupDetails,
};
