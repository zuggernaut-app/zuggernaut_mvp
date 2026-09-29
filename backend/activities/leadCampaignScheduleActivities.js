'use strict';

const mongoose = require('mongoose');
const { createLogger } = require('../lib/observability/logger');
const { pauseAdsCampaign } = require('../services/integrations/googleAdsCampaignClient');
const { fetchAdPolicyStatus } = require('../services/integrations/googleAdsReportClient');
const { sendEmail } = require('../lib/notifications/emailTransport');
const { requireSetupReadyConnection } = require('../services/capabilities/setupReadyConnectionService');
const {
  reconcilePendingEnablesForBusiness,
} = require('../services/capabilities/leadCampaignManagementService');
const { updateSlot, getLeadCampaignSet } = require('../services/capabilities/leadCampaignSetService');
const { LEAD_CAMPAIGN_SLOTS } = require('../constants/leadCampaign');
const { isWithinGracePeriod } = require('../services/billing/subscriptionGate');

const logger = createLogger({ name: 'leadCampaignScheduleActivities' });
const Subscription = mongoose.model('Subscription');
const IntegrationArtifact = mongoose.model('IntegrationArtifact');
const BusinessContext = mongoose.model('BusinessContext');
/**
 * Task 40a — grace-end pause across businesses.
 */
async function gracePauseExpiredSubscriptionsActivity() {
  const now = Date.now();
  const subs = await Subscription.find({
    status: { $nin: ['active', 'trialing'] },
  })
    .select('userId orgId status currentPeriodEnd')
    .lean();

  let paused = 0;
  for (const sub of subs) {
    if (isWithinGracePeriod(sub.currentPeriodEnd, now)) {
      continue;
    }

    const businesses = await BusinessContext.find(
      sub.orgId ? { orgId: sub.orgId } : { userId: sub.userId }
    )
      .select('businessId')
      .lean();

    for (const bc of businesses) {
      const businessId = bc.businessId;
      const set = await getLeadCampaignSet(businessId);
      if (!set) continue;

      for (const slot of LEAD_CAMPAIGN_SLOTS) {
        const slotDoc = set[slot];
        if (!slotDoc?.reservedAt || slotDoc.reviewStatus === 'retired') continue;

        await updateSlot(businessId, slot, {
          desiredState: 'paused',
          pauseReason: 'grace_expired',
          pendingProviderChange: undefined,
        });

        const artifact = await IntegrationArtifact.findOne({
          businessId,
          provider: 'google_ads',
          artifactType: 'ads_campaign',
          'metadata.slot': slot,
        }).lean();

        if (!artifact?.externalId) continue;

        try {
          await pauseAdsCampaign({ businessId, campaignResourceName: artifact.externalId });
          paused += 1;
        } catch (err) {
          logger.warn(
            { businessId: businessId.toString(), slot, err: err?.message },
            'grace pause failed'
          );
        }
      }

      await reconcilePendingEnablesForBusiness(businessId);
    }
  }

  return { paused };
}

/**
 * Task 41 — poll ad disapprovals (read-only); dedupe notifications in metadata.
 */
async function pollAdsDisapprovalsActivity() {
  const LeadCampaignSet = mongoose.model('LeadCampaignSet');
  const artifacts = await IntegrationArtifact.find({
    provider: 'google_ads',
    artifactType: 'ads_ad',
    'metadata.slot': { $exists: true },
  })
    .select('businessId externalId metadata setupRunId')
    .limit(500)
    .lean();

  const notified = [];
  for (const artifact of artifacts) {
    const slot = artifact.metadata?.slot;
    if (!slot) continue;

    let policy;
    try {
      const { customerId } = await requireSetupReadyConnection(artifact.businessId, 'google_ads');
      policy = await fetchAdPolicyStatus({
        businessId: artifact.businessId,
        customerId,
        adResourceName: artifact.externalId,
      });
    } catch (err) {
      logger.warn(
        { businessId: artifact.businessId.toString(), slot, err: err?.message },
        'ad policy poll failed'
      );
      continue;
    }

    if (policy.approvalStatus === 'APPROVED' || !policy.policyTopic) {
      continue;
    }

    const dedupeKey = `${artifact.externalId}:${policy.policyTopic}`;
    const set = await LeadCampaignSet.findOne({ businessId: artifact.businessId }).lean();
    const prior = Array.isArray(set?.[slot]?.disapprovalDedupeKeys) ? set[slot].disapprovalDedupeKeys : [];
    if (prior.includes(dedupeKey)) {
      continue;
    }

    const notification = {
      type: 'ad_disapproved',
      slot,
      dedupeKey,
      policyTopic: policy.policyTopic,
      adResourceName: artifact.externalId,
      createdAt: new Date(),
    };

    await LeadCampaignSet.updateOne(
      { businessId: artifact.businessId },
      {
        $addToSet: { [`${slot}.disapprovalDedupeKeys`]: dedupeKey },
        $push: { operatorNotifications: notification },
      }
    );

    const operatorEmail = process.env.OPERATOR_ALERT_EMAIL?.trim();
    if (operatorEmail) {
      try {
        await sendEmail({
          to: operatorEmail,
          subject: `Google Ads disapproval — business ${artifact.businessId.toString()} (${slot})`,
          text: `Ad ${artifact.externalId} was disapproved for topic "${policy.policyTopic}". Review in admin and send the campaign back to regenerate.`,
        });
      } catch (err) {
        logger.warn(
          { businessId: artifact.businessId.toString(), slot, err: err?.message },
          'operator disapproval email failed'
        );
      }
    }

    notified.push({ businessId: artifact.businessId.toString(), dedupeKey, slot });
    logger.info(
      { businessId: artifact.businessId.toString(), dedupeKey, slot, provider: 'google_ads' },
      'operator disapproval notification recorded'
    );
  }

  return { notifiedCount: notified.length, notified };
}

module.exports = {
  gracePauseExpiredSubscriptionsActivity,
  pollAdsDisapprovalsActivity,
};
