'use strict';

const mongoose = require('mongoose');
const { getTemporalClient } = require('../../lib/temporalClient');
const {
  SCRAPE_WORKFLOW_NAME,
  resolveTemporalTaskQueue,
} = require('../../constants/temporalDefaults');

const BusinessContext = mongoose.model('BusinessContext');
const ScrapeRun = mongoose.model('ScrapeRun');

const ONBOARDING_CLAIM_LEASE_MS = 5 * 60 * 1000;

class LeadCampaignScrapeError extends Error {
  constructor(message, code = 'LEAD_CAMPAIGN_SCRAPE_ERROR') {
    super(message);
    this.name = 'LeadCampaignScrapeError';
    this.code = code;
  }
}

/**
 * Fixed workflow ID per business for onboarding scrape.
 *
 * @param {import('mongoose').Types.ObjectId | string} businessId
 */
function onboardingScrapeWorkflowId(businessId) {
  return `onboarding-scrape-${businessId.toString()}`;
}

/**
 * Task 9b — atomic claim for onboarding scrape.
 *
 * @param {object} ctx
 */
async function claimOnboardingScrape(ctx) {
  const { businessId, userId, websiteUrl } = ctx;
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + ONBOARDING_CLAIM_LEASE_MS);

  let scrapeRun;
  try {
    scrapeRun = await ScrapeRun.findOneAndUpdate(
      {
        businessId,
        purpose: 'onboarding',
        $or: [
          { claimState: { $exists: false } },
          { claimState: 'dispatch_failed' },
          {
            claimState: 'claiming',
            claimLeaseExpiresAt: { $lte: now },
          },
        ],
      },
      {
        $setOnInsert: {
          businessId,
          userId,
          websiteUrl,
          purpose: 'onboarding',
          status: 'QUEUED',
        },
        $set: {
          claimState: 'claiming',
          claimLeaseExpiresAt: leaseUntil,
          websiteUrl,
          userId,
          status: 'QUEUED',
          lastErrorSummary: null,
        },
      },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
    );
  } catch (err) {
    if (err?.code === 11000) {
      const existing = await ScrapeRun.findOne({ businessId, purpose: 'onboarding' }).lean();
      if (existing?.claimState === 'running' || existing?.claimState === 'succeeded') {
        return { claimed: false, scrapeRun: existing, idempotent: true };
      }
      if (
        existing?.claimState === 'claiming' &&
        existing.claimLeaseExpiresAt &&
        new Date(existing.claimLeaseExpiresAt) > now
      ) {
        throw new LeadCampaignScrapeError(
          'Onboarding scrape already in progress.',
          'SCRAPE_CLAIM_IN_PROGRESS'
        );
      }
    }
    throw err;
  }

  if (!scrapeRun) {
    throw new LeadCampaignScrapeError('Failed to claim onboarding scrape.', 'SCRAPE_CLAIM_FAILED');
  }

  const wasReclaim =
    scrapeRun.claimState === 'claiming' &&
    scrapeRun.updatedAt &&
    scrapeRun.createdAt &&
    scrapeRun.updatedAt > scrapeRun.createdAt;

  return { claimed: true, scrapeRun, idempotent: false, wasReclaim: Boolean(wasReclaim) };
}

/**
 * Task 9 — start operator onboarding scrape with atomic claim + fixed workflow ID.
 *
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {import('mongoose').Types.ObjectId | string} operatorUserId
 */
async function startOperatorOnboardingScrape(businessId, operatorUserId) {
  const biz =
    businessId instanceof mongoose.Types.ObjectId
      ? businessId
      : new mongoose.Types.ObjectId(businessId);

  const bc = await BusinessContext.findOne({ businessId: biz }).lean();
  if (!bc) {
    throw new LeadCampaignScrapeError('Business not found.', 'not_found');
  }
  const websiteUrl = String(bc.websiteUrl ?? '').trim();
  if (!websiteUrl) {
    throw new LeadCampaignScrapeError('Business has no website URL.', 'validation_error');
  }

  const userId = bc.userId;
  const claim = await claimOnboardingScrape({ businessId: biz, userId, websiteUrl });
  if (!claim.claimed && claim.idempotent) {
    return {
      idempotent: true,
      scrapeRunId: claim.scrapeRun._id.toString(),
      workflowId: claim.scrapeRun.temporalWorkflowId ?? onboardingScrapeWorkflowId(biz),
      status: claim.scrapeRun.status,
      claimState: claim.scrapeRun.claimState,
    };
  }

  const scrapeRun = claim.scrapeRun;
  const workflowId = onboardingScrapeWorkflowId(biz);
  const taskQueue = resolveTemporalTaskQueue();
  const startedAt = new Date().toISOString();

  try {
    const client = await getTemporalClient();
    await client.workflow.start(SCRAPE_WORKFLOW_NAME, {
      taskQueue,
      workflowId,
      workflowIdReusePolicy: 'REJECT_DUPLICATE',
      args: [
        {
          scrapeRunId: scrapeRun._id.toString(),
          businessId: biz.toString(),
          userId: userId.toString(),
          websiteUrl,
          startedAt,
          purpose: 'onboarding',
        },
      ],
    });

    await ScrapeRun.updateOne(
      { _id: scrapeRun._id },
      {
        $set: {
          temporalWorkflowId: workflowId,
          status: 'RUNNING',
          claimState: 'running',
          claimLeaseExpiresAt: null,
        },
      }
    );

    return {
      idempotent: false,
      scrapeRunId: scrapeRun._id.toString(),
      workflowId,
      status: 'RUNNING',
      claimState: 'running',
    };
  } catch (err) {
    const summary =
      typeof err?.message === 'string' ? err.message : 'Temporal workflow start failed';
    await ScrapeRun.updateOne(
      { _id: scrapeRun._id },
      {
        $set: {
          status: 'FAILED',
          claimState: 'dispatch_failed',
          claimLeaseExpiresAt: null,
          lastErrorSummary: summary,
        },
      }
    );
    throw new LeadCampaignScrapeError(summary, 'temporal_unavailable');
  }
}

module.exports = {
  LeadCampaignScrapeError,
  onboardingScrapeWorkflowId,
  claimOnboardingScrape,
  startOperatorOnboardingScrape,
};
