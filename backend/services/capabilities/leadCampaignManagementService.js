'use strict';

const mongoose = require('mongoose');
const { FLOOR_DAILY_MICROS, PLAN_CEILING_DAILY_MICROS, LEAD_CAMPAIGN_SLOTS } = require('../../constants/leadCampaign');
const { createLogger } = require('../../lib/observability/logger');
const {
  enableAdsCampaign,
  pauseAdsCampaign,
  updateCampaignBudget,
  getAdsCampaignLiveState,
  isCampaignBudgetResourceName,
} = require('../integrations/googleAdsCampaignClient');
const { GoogleAdsApiError } = require('../integrations/googleAdsApiConfig');
const { getCustomerCurrencyCode } = require('../integrations/googleAdsAccountClient');
const { requireSetupReadyConnection } = require('./setupReadyConnectionService');
const {
  assertActivePlanForBusinessOwner,
  getSubscriptionStatusForBusinessOwner,
} = require('../billing/subscriptionGate');
const { isPlatformAdminUser } = require('../../api/v1/lib/platformAdminBusinessAccess');
const {
  assertBusinessMembershipOrOwnership,
  MembershipCheckError,
} = require('../../lib/auth/membershipCheck');
const { getLeadCampaignSet, updateSlot, bumpDesiredStateVersion } = require('./leadCampaignSetService');
const { isTrackingPassedForAction, refreshTrackingStatusForBusiness } = require('./leadCampaignTrackingService');
const { resolveBlockedState } = require('./blockedStateResolver');
const {
  mapManagementError,
  AdsCampaignManagementError,
} = require('./adsCampaignManagementService');

const IntegrationArtifact = mongoose.model('IntegrationArtifact');
const logger = createLogger({ name: 'leadCampaignManagementService' });

/**
 * @param {object | null | undefined} setDoc
 * @param {'recommended' | 'alternative'} slot
 * @param {object | null | undefined} slotDoc
 */
function hasCurrentDisapprovalNotification(setDoc, slot, slotDoc) {
  const currentAd = slotDoc?.providerResourceNames?.ad;
  if (!currentAd) return false;
  const notifications = Array.isArray(setDoc?.operatorNotifications) ? setDoc.operatorNotifications : [];
  return notifications.some(
    (notification) =>
      notification?.type === 'ad_disapproved' &&
      notification?.slot === slot &&
      notification?.adResourceName === currentAd
  );
}

/**
 * @param {string} userId
 * @param {string} businessIdRaw
 */
async function assertCampaignAccess(userId, businessIdRaw) {
  if (!businessIdRaw || !mongoose.Types.ObjectId.isValid(businessIdRaw)) {
    throw new AdsCampaignManagementError('businessId is required and must be valid.', 'validation_error');
  }
  const businessId = new mongoose.Types.ObjectId(businessIdRaw);
  const isAdmin = await isPlatformAdminUser(userId);
  if (!isAdmin) {
    try {
      await assertBusinessMembershipOrOwnership(userId, businessIdRaw);
    } catch (err) {
      if (err instanceof MembershipCheckError) {
        throw new AdsCampaignManagementError(
          err.code === 'forbidden' ? err.message : 'Business context not found for this user',
          err.code === 'forbidden' ? 'ADS_CAMPAIGN_FORBIDDEN' : 'ADS_CAMPAIGN_BUSINESS_NOT_FOUND'
        );
      }
      throw err;
    }
  }
  return businessId;
}

/**
 * @param {import('mongoose').Types.ObjectId} businessId
 * @param {'recommended' | 'alternative'} slot
 */
async function loadSlotCampaignArtifact(businessId, slot) {
  const artifact = await IntegrationArtifact.findOne({
    businessId,
    provider: 'google_ads',
    artifactType: 'ads_campaign',
    'metadata.slot': slot,
  })
    .sort({ updatedAt: -1 })
    .lean();

  if (!artifact?.externalId) {
    throw new AdsCampaignManagementError(
      `No campaign artifact found for slot ${slot}.`,
      'ADS_CAMPAIGN_NOT_FOUND'
    );
  }
  return artifact;
}

/**
 * @param {import('mongoose').Types.ObjectId} businessId
 */
async function resolvePlanCeilingMicros(businessId) {
  const { customerId } = await requireSetupReadyConnection(
    businessId,
    'google_ads',
    AdsCampaignManagementError
  );
  const provisioned = await IntegrationArtifact.findOne({
    businessId,
    provider: 'google_ads',
    artifactType: 'ads_customer',
  })
    .sort({ updatedAt: -1 })
    .lean();
  const provisionedCurrency =
    typeof provisioned?.metadata?.currencyCode === 'string'
      ? provisioned.metadata.currencyCode.trim().toUpperCase()
      : null;
  const currency =
    provisionedCurrency ||
    (process.env.GOOGLE_ADS_API_MOCK === 'true' || process.env.GOOGLE_ADS_API_ENABLED !== 'true'
      ? process.env.GOOGLE_ADS_DEFAULT_CURRENCY_CODE?.trim() || 'USD'
      : await getCustomerCurrencyCode({ businessId, customerId }));
  const normalizedCurrency = String(currency ?? 'USD').toUpperCase();

  const SubscriptionModel = mongoose.model('Subscription');
  const BusinessContext = mongoose.model('BusinessContext');
  const bc = await BusinessContext.findOne({ businessId }).select('orgId userId').lean();
  let subscription = null;
  if (bc?.orgId) {
    subscription = await SubscriptionModel.findOne({ orgId: bc.orgId }).populate('planId').lean();
  }
  if (!subscription && bc?.userId) {
    subscription = await SubscriptionModel.findOne({ userId: bc.userId }).populate('planId').lean();
  }

  const tier = subscription?.planId?.tier ?? 'starter';
  const ceiling = PLAN_CEILING_DAILY_MICROS[tier]?.[normalizedCurrency];
  const floor = FLOOR_DAILY_MICROS[normalizedCurrency] ?? FLOOR_DAILY_MICROS.USD;
  return { ceiling, floor, currency: normalizedCurrency, tier };
}

/**
 * @param {string} userId
 * @param {string} businessIdRaw
 */
async function getLeadCampaignDashboard(userId, businessIdRaw) {
  const businessId = await assertCampaignAccess(userId, businessIdRaw);
  const { ceiling, floor, currency } = await resolvePlanCeilingMicros(businessId);
  const BusinessContext = mongoose.model('BusinessContext');
  const bc = await BusinessContext.findOne({ businessId }).select('orderValueHint').lean();
  const orderValueHint =
    typeof bc?.orderValueHint === 'string' ? bc.orderValueHint.trim() : '';
  const recommendedBudgetLabel = orderValueHint || null;
  const recommendedBudgetMicros = orderValueHint ? null : floor;
  await refreshTrackingStatusForBusiness(businessId);
  const set = await getLeadCampaignSet(businessId);
  const subscriptionStatus = await getSubscriptionStatusForBusinessOwner(businessId);
  const slots = {};

  for (const slot of LEAD_CAMPAIGN_SLOTS) {
    const slotDoc = set?.[slot];
    if (!slotDoc?.reservedAt) {
      slots[slot] = null;
      continue;
    }

    let live = null;
    try {
      const artifact = await loadSlotCampaignArtifact(businessId, slot);
      live = await getAdsCampaignLiveState({ businessId, campaignResourceName: artifact.externalId });
    } catch {
      live = null;
    }

    const refreshedSlot = (await getLeadCampaignSet(businessId))?.[slot] ?? slotDoc;
    let blocked = null;
    if (refreshedSlot.reviewStatus === 'retired') {
      blocked = resolveBlockedState('campaign_retired');
    } else if (refreshedSlot.pauseReason === 'budget_adjustment_needed') {
      blocked = resolveBlockedState('budget_adjustment_needed');
    } else if (refreshedSlot.reviewStatus !== 'approved') {
      blocked = resolveBlockedState('operator_review_pending');
    } else if (!refreshedSlot.budgetConfirmedAt || !refreshedSlot.committedBudgetMicros) {
      blocked = resolveBlockedState('budget_not_set');
    } else if (!isTrackingPassedForAction(refreshedSlot, refreshedSlot.action)) {
      blocked = resolveBlockedState('tracking_not_passed');
    } else if (!subscriptionStatus.active) {
      blocked = resolveBlockedState(subscriptionStatus.code);
    } else if (hasCurrentDisapprovalNotification(set, slot, refreshedSlot)) {
      blocked = resolveBlockedState('ad_disapproved');
    }

    slots[slot] = {
      ...refreshedSlot,
      liveStatus: live?.status ?? null,
      amountMicros: live?.amountMicros ?? refreshedSlot.committedBudgetMicros ?? null,
      blocked,
    };
  }

  return {
    businessId: businessId.toString(),
    currency,
    budgetFloorMicros: floor,
    budgetCeilingMicros: ceiling,
    recommendedBudgetLabel,
    recommendedBudgetMicros,
    subscriptionActive: subscriptionStatus.active,
    slots,
  };
}

/**
 * Task 33 — enable campaign by slot.
 */
async function enableCampaignSlotForBusiness(userId, businessIdRaw, slot) {
  if (!LEAD_CAMPAIGN_SLOTS.includes(slot)) {
    throw new AdsCampaignManagementError('Invalid slot.', 'validation_error');
  }

  const businessId = await assertCampaignAccess(userId, businessIdRaw);
  const set = await getLeadCampaignSet(businessId);
  const slotDoc = set?.[slot];

  if (!slotDoc?.reservedAt) {
    throw new AdsCampaignManagementError('Slot not found.', 'ADS_CAMPAIGN_NOT_FOUND');
  }
  if (slotDoc.reviewStatus === 'retired') {
    throw new AdsCampaignManagementError('Campaign is retired.', 'campaign_retired');
  }
  if (slotDoc.reviewStatus !== 'approved') {
    throw new AdsCampaignManagementError(
      'Operator approval is required before starting.',
      'operator_review_pending'
    );
  }
  if (!slotDoc.budgetConfirmedAt || !slotDoc.committedBudgetMicros) {
    throw new AdsCampaignManagementError('Budget must be confirmed before starting.', 'budget_not_set');
  }

  await refreshTrackingStatusForBusiness(businessId);
  const refreshed = await getLeadCampaignSet(businessId);
  const action = refreshed?.[slot]?.action ?? slotDoc.action;
  if (!isTrackingPassedForAction(refreshed?.[slot] ?? slotDoc, action)) {
    throw new AdsCampaignManagementError(
      'Tracking verification has not passed for this campaign action.',
      'tracking_not_passed'
    );
  }

  if (slotDoc.pauseReason === 'budget_adjustment_needed') {
    throw new AdsCampaignManagementError(
      'Budget adjustment is required before starting.',
      'budget_adjustment_needed'
    );
  }

  const isAdmin = await isPlatformAdminUser(userId);
  if (!isAdmin) {
    await assertActivePlanForBusinessOwner(businessId);
  }

  if (slotDoc.pauseReason === 'grace_expired') {
    await updateSlot(businessId, slot, { pauseReason: null });
  }

  const artifact = await loadSlotCampaignArtifact(businessId, slot);
  const campaignResourceName = String(artifact.externalId).trim();
  const liveBefore = await getAdsCampaignLiveState({ businessId, campaignResourceName });

  if (liveBefore.status === 'ENABLED') {
    return { outcome: 'no_op_already_enabled', status: liveBefore.status, slot };
  }

  const version = slotDoc.desiredStateVersion ?? 0;
  await updateSlot(
    businessId,
    slot,
    {
      desiredState: 'enabled',
      pendingProviderChange: { type: 'enable', requestedAt: new Date().toISOString() },
    },
    version,
    { incrementVersion: true }
  );

  const result = await enableAdsCampaign({ businessId, campaignResourceName });
  const liveAfter = await getAdsCampaignLiveState({ businessId, campaignResourceName });

  await updateSlot(businessId, slot, {
    desiredState: 'enabled',
    pendingProviderChange: undefined,
    pauseReason: null,
  });

  logger.info(
    { businessId: businessId.toString(), slot, provider: 'google_ads', outcome: result.outcome },
    'lead campaign slot enabled'
  );

  return { outcome: result.outcome, status: liveAfter.status, slot };
}

/**
 * Task 33 — pause campaign by slot.
 */
async function pauseCampaignSlotForBusiness(userId, businessIdRaw, slot) {
  if (!LEAD_CAMPAIGN_SLOTS.includes(slot)) {
    throw new AdsCampaignManagementError('Invalid slot.', 'validation_error');
  }

  const businessId = await assertCampaignAccess(userId, businessIdRaw);
  const artifact = await loadSlotCampaignArtifact(businessId, slot);
  const campaignResourceName = String(artifact.externalId).trim();
  const liveBefore = await getAdsCampaignLiveState({ businessId, campaignResourceName });

  if (liveBefore.status === 'PAUSED') {
    return { outcome: 'no_op_already_paused', status: liveBefore.status, slot };
  }

  const set = await getLeadCampaignSet(businessId);
  const version = set?.[slot]?.desiredStateVersion ?? 0;
  await updateSlot(
    businessId,
    slot,
    {
      desiredState: 'paused',
      pendingProviderChange: { type: 'pause', requestedAt: new Date().toISOString() },
    },
    version,
    { incrementVersion: true }
  );

  const result = await pauseAdsCampaign({ businessId, campaignResourceName });
  const liveAfter = await getAdsCampaignLiveState({ businessId, campaignResourceName });
  await updateSlot(businessId, slot, { desiredState: 'paused', pendingProviderChange: undefined });

  return { outcome: result.outcome, status: liveAfter.status, slot };
}

/**
 * Task 34 — set budget for slot with floor/ceiling checks.
 */
async function updateBudgetSlotForBusiness(userId, businessIdRaw, slot, amountMicros) {
  if (!LEAD_CAMPAIGN_SLOTS.includes(slot)) {
    throw new AdsCampaignManagementError('Invalid slot.', 'validation_error');
  }

  const parsedAmount = Number(amountMicros);
  const businessId = await assertCampaignAccess(userId, businessIdRaw);
  const { ceiling, floor } = await resolvePlanCeilingMicros(businessId);

  if (!Number.isFinite(parsedAmount) || parsedAmount < floor) {
    throw new AdsCampaignManagementError(
      `Daily budget must be at least ${floor} micros.`,
      'ADS_CAMPAIGN_BUDGET_TOO_LOW'
    );
  }

  const set = await getLeadCampaignSet(businessId);
  const otherSlot = slot === 'recommended' ? 'alternative' : 'recommended';
  const otherBudget = set?.[otherSlot]?.committedBudgetMicros ?? 0;
  if (parsedAmount + otherBudget > ceiling) {
    throw new AdsCampaignManagementError(
      `Combined daily budgets cannot exceed ${ceiling} micros for your plan.`,
      'ADS_CAMPAIGN_BUDGET_MAX_EXCEEDED'
    );
  }

  const version = set?.[slot]?.desiredStateVersion ?? 0;
  await updateSlot(
    businessId,
    slot,
    {
      committedBudgetMicros: parsedAmount,
      pendingProviderChange: {
        type: 'budget',
        amountMicros: parsedAmount,
        requestedAt: new Date().toISOString(),
      },
    },
    version
  );

  const artifact = await loadSlotCampaignArtifact(businessId, slot);
  const budgetFromMeta = artifact?.metadata?.budgetResourceName;
  let budgetResourceName = isCampaignBudgetResourceName(budgetFromMeta)
    ? String(budgetFromMeta).trim()
    : null;

  if (!budgetResourceName) {
    const budgetArtifact = await IntegrationArtifact.findOne({
      businessId,
      provider: 'google_ads',
      artifactType: 'ads_campaign_budget',
      'metadata.slot': slot,
    }).lean();
    if (budgetArtifact && isCampaignBudgetResourceName(budgetArtifact.externalId)) {
      budgetResourceName = String(budgetArtifact.externalId).trim();
    }
  }

  if (!budgetResourceName) {
    throw new AdsCampaignManagementError('Budget resource not found.', 'ADS_CAMPAIGN_BUDGET_NOT_FOUND');
  }

  const result = await updateCampaignBudget({
    businessId,
    budgetResourceName,
    amountMicros: parsedAmount,
  });

  await updateSlot(businessId, slot, {
    pendingProviderChange: undefined,
    pauseReason: null,
  });

  return { outcome: result.outcome, amountMicros: parsedAmount, slot };
}

/**
 * Task 35 — confirm budget on first start.
 */
async function confirmBudgetSlotForBusiness(userId, businessIdRaw, slot, amountMicros) {
  const businessId = await assertCampaignAccess(userId, businessIdRaw);
  const set = await getLeadCampaignSet(businessId);
  const slotDoc = set?.[slot];
  if (!slotDoc?.reservedAt) {
    throw new AdsCampaignManagementError('Slot not found.', 'ADS_CAMPAIGN_NOT_FOUND');
  }
  if (slotDoc.budgetConfirmedAt) {
    return { outcome: 'no_op_already_confirmed', slot, budgetConfirmedAt: slotDoc.budgetConfirmedAt };
  }

  await updateBudgetSlotForBusiness(userId, businessIdRaw, slot, amountMicros);

  const confirmedAt = new Date();
  const doc = await updateSlot(businessId, slot, {
    budgetConfirmedAt: confirmedAt,
  });

  return {
    outcome: 'confirmed',
    slot,
    budgetConfirmedAt: confirmedAt,
    amountMicros: doc[slot]?.committedBudgetMicros,
  };
}

/**
 * Task 36c — mark adjustment needed on downgrade.
 *
 * @param {import('mongoose').Types.ObjectId | string} businessId
 * @param {string} newTier
 */
async function applyDowngradeAdjustmentNeeded(businessId, newTier) {
  const { ceiling } = await resolvePlanCeilingMicros(businessId);
  const set = await getLeadCampaignSet(businessId);
  if (!set) return { adjusted: false };

  let adjusted = false;
  for (const slot of LEAD_CAMPAIGN_SLOTS) {
    const slotDoc = set[slot];
    if (!slotDoc?.committedBudgetMicros) continue;
    const otherSlot = slot === 'recommended' ? 'alternative' : 'recommended';
    const combined =
      slotDoc.committedBudgetMicros + (set[otherSlot]?.committedBudgetMicros ?? 0);
    if (combined > ceiling) {
      await updateSlot(businessId, slot, {
        pauseReason: 'budget_adjustment_needed',
      });
      adjusted = true;
    }
  }
  return { adjusted, ceiling };
}

/**
 * Task 34c — reconcile pending enables; grace expiry wins.
 */
async function reconcilePendingEnablesForBusiness(businessId) {
  const set = await getLeadCampaignSet(businessId);
  if (!set) return { reconciled: 0 };

  let reconciled = 0;
  for (const slot of LEAD_CAMPAIGN_SLOTS) {
    const slotDoc = set[slot];
    if (!slotDoc?.pendingProviderChange?.type) continue;
    if (slotDoc.pauseReason === 'grace_expired' || slotDoc.pauseReason === 'budget_adjustment_needed') {
      await updateSlot(businessId, slot, { pendingProviderChange: undefined });
      reconciled += 1;
      continue;
    }

    if (slotDoc.pendingProviderChange.type === 'enable' && slotDoc.desiredState === 'enabled') {
      try {
        const artifact = await loadSlotCampaignArtifact(businessId, slot);
        await enableAdsCampaign({ businessId, campaignResourceName: artifact.externalId });
        await updateSlot(businessId, slot, { pendingProviderChange: undefined });
        reconciled += 1;
      } catch (err) {
        logger.warn(
          { businessId: businessId.toString(), slot, err: err?.message },
          'pending enable reconcile failed'
        );
      }
    }
  }
  return { reconciled };
}

module.exports = {
  assertCampaignAccess,
  getLeadCampaignDashboard,
  enableCampaignSlotForBusiness,
  pauseCampaignSlotForBusiness,
  updateBudgetSlotForBusiness,
  confirmBudgetSlotForBusiness,
  applyDowngradeAdjustmentNeeded,
  reconcilePendingEnablesForBusiness,
};
