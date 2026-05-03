'use strict';

const { proxyActivities } = require('@temporalio/workflow');

const {
  checkRobotsActivity,
  scrapeStaticActivity,
  scrapeHeadlessActivity,
  normalizeScrapeActivity,
  persistScrapeResultActivity,
} = proxyActivities({
  startToCloseTimeout: '4 minutes',
  retry: {
    maximumAttempts: 4,
    initialInterval: '2 seconds',
    backoffCoefficient: 2,
  },
});

/**
 * Async website scrape: robots, static HTML, optional Playwright fallback, normalize, persist to BusinessContext.
 *
 * @param {{ scrapeRunId?: string, businessId?: string, userId?: string, websiteUrl?: string, startedAt?: string }} input
 */
async function scrapeWorkflow(input) {
  const safe = input && typeof input === 'object' ? input : {};
  const scrapeRunId = typeof safe.scrapeRunId === 'string' ? safe.scrapeRunId.trim() : '';
  const businessId = typeof safe.businessId === 'string' ? safe.businessId.trim() : '';
  const userId = typeof safe.userId === 'string' ? safe.userId.trim() : '';
  const websiteUrl = typeof safe.websiteUrl === 'string' ? safe.websiteUrl.trim() : '';
  const startedAt =
    typeof safe.startedAt === 'string'
      ? safe.startedAt
      : new Date().toISOString();

  if (!scrapeRunId || !businessId || !userId || !websiteUrl) {
    return {
      workflow: 'scrapeWorkflow',
      status: 'FAILED',
      error: 'missing_required_fields',
    };
  }

  const robots = await checkRobotsActivity({ websiteUrl });

  let staticResult = null;
  let headlessResult = null;

  if (robots.allowed) {
    staticResult = await scrapeStaticActivity({ websiteUrl });
    if (staticResult && staticResult.recommendHeadless) {
      headlessResult = await scrapeHeadlessActivity({ websiteUrl });
    }
  }

  const { status, suggested, rawPayload } = await normalizeScrapeActivity({
    websiteUrl,
    scrapeRunId,
    startedAt,
    robots: { allowed: robots.allowed, reason: robots.reason },
    staticResult,
    headlessResult,
  });

  await persistScrapeResultActivity({
    scrapeRunId,
    businessId,
    userId,
    websiteUrl,
    status,
    suggested,
    rawPayload,
  });

  return {
    workflow: 'scrapeWorkflow',
    scrapeRunId,
    status,
  };
}

module.exports = { scrapeWorkflow };
