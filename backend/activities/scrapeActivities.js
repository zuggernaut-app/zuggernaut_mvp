'use strict';

const mongoose = require('mongoose');
const { ApplicationFailure } = require('@temporalio/activity');
const { createLogger } = require('../lib/observability/logger');
const { checkRobotsAllowedForUrl } = require('../services/scraper/robots');
const { runStaticScrape } = require('../services/scraper/staticScraper');
const { runHeadlessScrape } = require('../services/scraper/headlessScraper');
const { normalizeScrapeResult } = require('../services/scraper/normalize');
const { assertUrlAllowed, SsrfError } = require('../lib/ssrf');

const logger = createLogger({ name: 'scrapeActivities' });

const BusinessContext = mongoose.model('BusinessContext');
const ScrapeRun = mongoose.model('ScrapeRun');

function redactMongoUri(uri) {
  return typeof uri === 'string' ? uri.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@') : '';
}

/**
 * @param {{ websiteUrl: string }} input
 */
async function checkRobotsActivity(input) {
  const websiteUrl = typeof input?.websiteUrl === 'string' ? input.websiteUrl.trim() : '';
  if (!websiteUrl) {
    return { allowed: false, reason: 'missing_url' };
  }
  try {
    await assertUrlAllowed(websiteUrl);
  } catch (err) {
    const reason = err instanceof SsrfError ? err.code || 'ssrf_blocked' : 'ssrf_blocked';
    logger.info({ websiteUrl, allowed: false, reason }, 'robots_check');
    return { allowed: false, reason };
  }
  const out = await checkRobotsAllowedForUrl(websiteUrl);
  logger.info({ websiteUrl, ...out }, 'robots_check');
  return out;
}

function stripForTemporal(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const { aggregate, ...rest } = obj;
  return rest;
}

/**
 * @param {{ websiteUrl: string }} input
 */
async function scrapeStaticActivity(input) {
  const websiteUrl = typeof input?.websiteUrl === 'string' ? input.websiteUrl.trim() : '';
  if (!websiteUrl) {
    throw ApplicationFailure.nonRetryable('missing websiteUrl', 'ScrapeValidation');
  }
  try {
    await assertUrlAllowed(websiteUrl);
    const raw = await runStaticScrape(websiteUrl);
    return stripForTemporal(raw);
  } catch (err) {
    if (err instanceof SsrfError) {
      throw ApplicationFailure.nonRetryable(err.code || 'ssrf_blocked', 'SsrfBlocked');
    }
    const msg = typeof err?.message === 'string' ? err.message : 'static_scrape_failed';
    logger.warn({ err: msg, websiteUrl }, 'scrape_static_failed');
    throw ApplicationFailure.retryable(msg, 'ScrapeStaticRetryable');
  }
}

/**
 * @param {{ websiteUrl: string }} input
 */
async function scrapeHeadlessActivity(input) {
  const websiteUrl = typeof input?.websiteUrl === 'string' ? input.websiteUrl.trim() : '';
  if (!websiteUrl) {
    throw ApplicationFailure.nonRetryable('missing websiteUrl', 'ScrapeValidation');
  }
  try {
    await assertUrlAllowed(websiteUrl);
    const raw = await runHeadlessScrape(websiteUrl);
    return stripForTemporal(raw);
  } catch (err) {
    if (err instanceof SsrfError) {
      throw ApplicationFailure.nonRetryable(err.code || 'ssrf_blocked', 'SsrfBlocked');
    }
    const msg = typeof err?.message === 'string' ? err.message : 'headless_scrape_failed';
    logger.warn({ err: msg, websiteUrl }, 'scrape_headless_failed');
    throw ApplicationFailure.retryable(msg, 'ScrapeHeadlessRetryable');
  }
}

/**
 * @param {object} input
 */
async function normalizeScrapeActivity(input) {
  try {
    return normalizeScrapeResult(input);
  } catch (err) {
    const msg = typeof err?.message === 'string' ? err.message : 'normalize_failed';
    throw ApplicationFailure.nonRetryable(msg, 'ScrapeNormalize');
  }
}

/** Preserve existing scrape blob keys and append `runs`. */
function mergeRawScrapeOutput(existing, rawPayload) {
  const prev =
    existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const runs = Array.isArray(prev.runs) ? [...prev.runs] : [];
  runs.push(rawPayload);
  return { ...prev, runs };
}

/**
 * @param {{
 *   scrapeRunId: string,
 *   businessId: string,
 *   userId: string,
 *   websiteUrl: string,
 *   status: string,
 *   suggested: object,
 *   rawPayload: object,
 * }} input
 */
async function persistScrapeResultActivity(input) {
  const scrapeRunIdRaw = typeof input?.scrapeRunId === 'string' ? input.scrapeRunId.trim() : '';
  const businessIdRaw = typeof input?.businessId === 'string' ? input.businessId.trim() : '';
  const userIdRaw = typeof input?.userId === 'string' ? input.userId.trim() : '';
  const websiteUrl = typeof input?.websiteUrl === 'string' ? input.websiteUrl.trim() : '';

  if (
    !scrapeRunIdRaw ||
    !mongoose.Types.ObjectId.isValid(scrapeRunIdRaw) ||
    !businessIdRaw ||
    !mongoose.Types.ObjectId.isValid(businessIdRaw) ||
    !userIdRaw ||
    !mongoose.Types.ObjectId.isValid(userIdRaw)
  ) {
    throw ApplicationFailure.nonRetryable('Invalid persist ids', 'ScrapePersistValidation');
  }

  const scrapeRunId = new mongoose.Types.ObjectId(scrapeRunIdRaw);
  const businessId = new mongoose.Types.ObjectId(businessIdRaw);
  const userId = new mongoose.Types.ObjectId(userIdRaw);

  const status = typeof input?.status === 'string' ? input.status : 'FAILED';
  const suggested = input?.suggested && typeof input.suggested === 'object' ? input.suggested : {};
  const rawPayload =
    input?.rawPayload && typeof input.rawPayload === 'object' ? input.rawPayload : {};

  const run = await ScrapeRun.findById(scrapeRunId).lean();
  if (!run) {
    const hint = redactMongoUri(process.env.MONGODB_URI || 'mongodb://localhost:27017/zuggernaut_test');
    throw ApplicationFailure.nonRetryable(
      `ScrapeRun ${scrapeRunIdRaw} not found in worker MongoDB. Use the same MONGODB_URI for API and worker (${hint}).`,
      'ScrapeRunNotFoundInWorkerDb'
    );
  }

  if (String(run.businessId) !== String(businessId) || String(run.userId) !== String(userId)) {
    throw ApplicationFailure.nonRetryable('ScrapeRun tenant mismatch', 'ScrapePersistTenant');
  }

  const doc = await BusinessContext.findOne({ businessId, userId }).select('+rawScrapeOutput');
  if (!doc) {
    throw ApplicationFailure.nonRetryable('BusinessContext not found', 'BusinessContextNotFound');
  }

  const runs = doc.rawScrapeOutput && Array.isArray(doc.rawScrapeOutput.runs) ? doc.rawScrapeOutput.runs : [];
  if (runs.some((r) => r && String(r.scrapeRunId) === scrapeRunIdRaw)) {
    await ScrapeRun.updateOne(
      { _id: scrapeRunId },
      {
        $set: {
          status,
          resultSuggested: suggested,
          persistedAt: run.persistedAt || new Date(),
          lastErrorSummary: null,
          meta: {
            ...(run.meta && typeof run.meta === 'object' ? Object(run.meta) : {}),
            idempotentHit: true,
          },
        },
      }
    );
    logger.info({ scrapeRunId: scrapeRunIdRaw }, 'persist_scrape_idempotent_skip');
    return { persisted: true, idempotent: true };
  }

  try {
    doc.websiteUrl = websiteUrl || doc.websiteUrl;
    doc.rawScrapeOutput = mergeRawScrapeOutput(doc.rawScrapeOutput, {
      ...rawPayload,
      scrapeRunId: scrapeRunIdRaw,
    });
    doc.markModified('rawScrapeOutput');
    await doc.save();

    await ScrapeRun.updateOne(
      { _id: scrapeRunId },
      {
        $set: {
          status,
          resultSuggested: suggested,
          persistedAt: new Date(),
          lastErrorSummary: null,
          meta: {
            rawAppended: true,
            terminalStatus: status,
          },
        },
      }
    );

    logger.info({ scrapeRunId: scrapeRunIdRaw, status }, 'persist_scrape_complete');
    return { persisted: true, idempotent: false };
  } catch (err) {
    const summary = typeof err?.message === 'string' ? err.message : 'persist_failed';
    await ScrapeRun.updateOne(
      { _id: scrapeRunId },
      { $set: { status: 'FAILED', lastErrorSummary: summary } }
    ).catch((e) => logger.error({ err: e }, 'ScrapeRun failure status write failed'));
    throw ApplicationFailure.nonRetryable(summary, 'ScrapePersistError');
  }
}

const AI_FILL_FIELDS = [
  { field: 'services', sourceKey: 'services' },
  { field: 'whoBuysToday', sourceKey: 'whoBuysToday' },
  { field: 'serviceAreas', sourceKey: 'serviceAreas' },
  { field: 'orderValueHint', sourceKey: 'orderValueHint' },
  { field: 'howBuyersContact', sourceKey: 'howBuyersContact' },
];

/**
 * Task 11b — fill only unset intake fields from scrape + LLM; never overwrite customer values.
 *
 * @param {{ businessId: string, suggested: object }} input
 */
const { generateFiveAnswersFromScrape } = require('../services/capabilities/leadCampaignContentService');

async function fillFiveAnswersFromScrapeActivity(input) {
  const businessIdRaw = typeof input?.businessId === 'string' ? input.businessId.trim() : '';
  if (!businessIdRaw || !mongoose.Types.ObjectId.isValid(businessIdRaw)) {
    throw ApplicationFailure.nonRetryable('Invalid businessId', 'AiFillValidation');
  }
  const businessId = new mongoose.Types.ObjectId(businessIdRaw);
  const suggested = input?.suggested && typeof input.suggested === 'object' ? input.suggested : {};

  const doc = await BusinessContext.findOne({ businessId });
  if (!doc) {
    throw ApplicationFailure.nonRetryable('BusinessContext not found', 'BusinessContextNotFound');
  }

  const llmSuggested = await generateFiveAnswersFromScrape({
    businessName: doc.businessName,
    websiteUrl: doc.websiteUrl,
    suggested,
  });
  const mergedSuggested = { ...suggested, ...llmSuggested };

  const sources = { ...(doc.intakeFieldSources ?? {}) };
  const updates = {};

  for (const { field, sourceKey } of AI_FILL_FIELDS) {
    const existingSource = sources[sourceKey] ?? sources[field];
    if (existingSource === 'customer' || existingSource === 'operator') {
      continue;
    }

    const current =
      field === 'services' || field === 'serviceAreas'
        ? Array.isArray(doc[field]) ? doc[field] : []
        : String(doc[field] ?? '').trim();

    const hasValue =
      field === 'services' || field === 'serviceAreas'
        ? current.length > 0
        : Boolean(current);

    if (hasValue) {
      continue;
    }

    const fromSuggested = mergedSuggested[sourceKey] ?? mergedSuggested[field];
    if (fromSuggested == null || fromSuggested === '') {
      continue;
    }

    if (field === 'services' || field === 'serviceAreas') {
      const list = Array.isArray(fromSuggested)
        ? fromSuggested
        : String(fromSuggested)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
      if (list.length === 0) continue;
      updates[field] = list;
    } else {
      updates[field] = String(fromSuggested).trim();
    }
    sources[sourceKey] = 'ai_guess';
  }

  if (Object.keys(updates).length === 0) {
    return { filled: false, idempotent: true };
  }

  doc.set({ ...updates, intakeFieldSources: sources });
  await doc.save();

  return { filled: true, fields: Object.keys(updates) };
}

module.exports = {
  checkRobotsActivity,
  scrapeStaticActivity,
  scrapeHeadlessActivity,
  normalizeScrapeActivity,
  persistScrapeResultActivity,
  fillFiveAnswersFromScrapeActivity,
};
