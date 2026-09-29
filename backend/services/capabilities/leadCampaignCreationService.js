'use strict';

const mongoose = require('mongoose');
const { SETUP_STEP_NAMES } = require('../../constants/setupWorkflow');
const {
  businessScopedIdempotencyKey,
  findReusableArtifact,
  adsCampaignIdempotencyKey,
} = require('../../constants/idempotency');
const { computeBusinessIntentFingerprint } = require('../../lib/idempotency/businessIntentFingerprint');
const { FLOOR_DAILY_MICROS, SUPPORTED_ACCOUNT_CURRENCIES } = require('../../constants/leadCampaign');
const {
  createCampaignBudget,
  createCampaign,
  createCampaignGeoTarget,
  createAdGroup,
  createAdGroupKeyword,
  createCustomConversionGoal,
  createResponsiveSearchAd,
  linkCampaignToCustomConversionGoal,
  resolveConversionActionResourceName,
  createCallAssetOnly,
  linkCallAssetToCampaign,
} = require('../integrations/googleAdsCampaignClient');
const { GoogleAdsApiError } = require('../integrations/googleAdsConversionCatalogClient');
const { getCustomerCurrencyCode } = require('../integrations/googleAdsAccountClient');
const { planLeadCampaignSlots } = require('./leadCampaignPlanner');
const { reserveSlot, updateSlot, getLeadCampaignSet } = require('./leadCampaignSetService');
const {
  claimProviderResource,
  finalizeProviderResourceClaim,
  markProviderResourceClaimFailed,
  isCreatedProviderArtifact,
} = require('./providerResourceClaim');
const adsCampaignIntentService = require('./adsCampaignIntentService');
const {
  validateBusinessContextAdsReadiness,
  formatAdsReadinessSummary,
} = require('./businessContextAdsReadinessService');
const {
  prepareCompliantCampaignPlan,
  AdsProviderPreconditionError,
  findExistingAdsArtifact,
  persistAdsArtifact,
  susoVersionBlocksCrossRunReuse,
} = require('./adsAutoCampaignService');
const { parseInternationalPhone } = require('../scraper/phoneUtils');
const { parsePhoneNumberFromString } = require('libphonenumber-js/min');
const { generateCampaignSlotContent } = require('./leadCampaignContentService');

const CampaignPlan = mongoose.model('CampaignPlan');
const IntegrationArtifact = mongoose.model('IntegrationArtifact');

/** @type {boolean | null} */
let legacyCampaignPlanSetupRunOnlyIndexPresent = null;

/**
 * Detect the pre-slot unique index on setupRunId alone (blocks dual-slot plans).
 */
async function hasLegacyCampaignPlanSetupRunOnlyIndex() {
  if (legacyCampaignPlanSetupRunOnlyIndexPresent !== null) {
    return legacyCampaignPlanSetupRunOnlyIndexPresent;
  }

  const indexes = await CampaignPlan.collection.indexes();
  legacyCampaignPlanSetupRunOnlyIndexPresent = indexes.some((idx) => {
    const keys = Object.keys(idx.key);
    return keys.length === 1 && keys[0] === 'setupRunId' && idx.unique === true;
  });
  return legacyCampaignPlanSetupRunOnlyIndexPresent;
}

/**
 * @param {object} bc
 * @returns {{ e164: string, nationalNumber: string, countryCode: string } | null}
 */
/**
 * @param {'calls' | 'forms'} action
 */
function slotActionToLogicalCategory(action) {
  return action === 'calls' ? 'call' : 'form';
}

/**
 * @param {object[]} conversionArtifacts
 * @param {string} customerId
 * @param {'calls' | 'forms'} action
 */
function resolveSlotConversionResource(conversionArtifacts, customerId, action) {
  const category = slotActionToLogicalCategory(action);
  let conv = conversionArtifacts.find(
    (c) => c.metadata?.logicalCategory === category || c.metadata?.slot === category
  );
  if (!conv && conversionArtifacts.length === 1) {
    conv = conversionArtifacts[0];
  }
  if (!conv) return null;
  return resolveConversionActionResourceName(
    customerId,
    conv.metadata?.resourceName ?? null,
    conv.externalId
  );
}

function resolveCanonicalPhone(bc) {
  const cm = bc?.contactMethods;
  if (!cm || typeof cm !== 'object') return null;

  const raw =
    (Array.isArray(cm.phones) && cm.phones[0] ? String(cm.phones[0]).trim() : null) ||
    (cm.phone ? String(cm.phone).trim() : null);
  if (!raw) return null;

  const countryCode = String(bc.businessCountry ?? 'US').slice(0, 2).toUpperCase();
  const parsed = parseInternationalPhone(raw, countryCode);
  if (!parsed?.e164) return null;

  const phone = parsePhoneNumberFromString(parsed.e164);
  if (!phone?.isValid()) return null;

  return {
    e164: parsed.e164,
    nationalNumber: String(phone.nationalNumber),
    countryCode: phone.country || countryCode,
  };
}

/**
 * @param {object} bc
 * @param {object} slotPlan
 */
function businessContextForSlot(bc, slotPlan) {
  return {
    ...bc,
    goals: { ...(bc.goals ?? {}), primary: slotPlan.action },
    services: [slotPlan.offer],
    serviceAreas: slotPlan.places,
  };
}

/**
 * Create paused lead campaigns for managed MVP slots.
 *
 * @param {object} ctx
 */
async function createLeadCampaignsForSetupRun(ctx) {
  const { setupRunId, businessId, customerId, bc, conversionArtifacts, logger } = ctx;

  const currencyCode =
    process.env.GOOGLE_ADS_API_MOCK === 'true' || process.env.GOOGLE_ADS_API_ENABLED !== 'true'
      ? process.env.GOOGLE_ADS_DEFAULT_CURRENCY_CODE?.trim() || 'USD'
      : await getCustomerCurrencyCode({ businessId, customerId });
  const normalizedCurrency = String(currencyCode ?? 'USD').toUpperCase();
  if (!SUPPORTED_ACCOUNT_CURRENCIES.includes(normalizedCurrency)) {
    throw new AdsProviderPreconditionError(
      `Google Ads account currency ${normalizedCurrency} is not supported.`,
      'ADS_UNSUPPORTED_CURRENCY'
    );
  }

  const budgetAmountMicros =
    FLOOR_DAILY_MICROS[normalizedCurrency] ?? FLOOR_DAILY_MICROS.USD;
  const currentSusoVersion = typeof bc.susoVersion === 'number' ? bc.susoVersion : 0;
  const intentFingerprint = computeBusinessIntentFingerprint(bc);
  const slotPlans = planLeadCampaignSlots(bc);

  const toCreate = [];
  if (slotPlans.recommended) toCreate.push(['recommended', slotPlans.recommended]);
  if (slotPlans.alternative) toCreate.push(['alternative', slotPlans.alternative]);

  if (toCreate.length === 0) {
    throw new AdsProviderPreconditionError(
      'No real offer or place for campaign creation.',
      'ADS_NO_CAMPAIGN_SLOTS'
    );
  }

  let newArtifacts = 0;
  let reusedArtifacts = 0;
  let source = process.env.GOOGLE_ADS_API_MOCK === 'true' ? 'google_ads_api_mock' : 'google_ads_api';
  const slotSummaries = [];

  const existingSet = await getLeadCampaignSet(businessId);

  for (const [slot, slotPlan] of toCreate) {
    if (existingSet?.[slot]?.reviewStatus === 'retired') {
      slotSummaries.push({
        slot,
        blocked: true,
        blockedReason: 'campaign_retired',
        message: 'Retired campaign slots are not recreated.',
      });
      continue;
    }

    if (slot === 'alternative' && (await hasLegacyCampaignPlanSetupRunOnlyIndex())) {
      const blockedReason = 'legacy_campaign_plan_index';
      const blockedMessage =
        'Alternative campaign creation is blocked until the CampaignPlan index migration completes.';

      logger.warn(
        {
          setupRunId: setupRunId.toString(),
          businessId: businessId.toString(),
          stepName: SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
          provider: 'google_ads',
          slot,
          blockedReason,
        },
        'alternative slot blocked pending CampaignPlan index migration'
      );

      await reserveSlot(businessId, slot, {
        action: slotPlan.action,
        offer: slotPlan.offer,
        places: slotPlan.places,
      });
      await updateSlot(businessId, slot, {
        reviewStatus: 'internal_review',
        pendingProviderChange: {
          kind: 'migration_blocked',
          blockedReason,
          message: blockedMessage,
          blockedAt: new Date().toISOString(),
        },
      });

      slotSummaries.push({
        slot,
        blocked: true,
        blockedReason,
        message: blockedMessage,
      });
      continue;
    }

    await reserveSlot(businessId, slot, {
      action: slotPlan.action,
      offer: slotPlan.offer,
      places: slotPlan.places,
    });

    const bcSlot = businessContextForSlot(bc, slotPlan);
    const readiness = await validateBusinessContextAdsReadiness(bcSlot);
    if (!readiness.ok) {
      throw new AdsProviderPreconditionError(
        formatAdsReadinessSummary(readiness),
        readiness.issues[0]?.code ?? 'ADS_READINESS_INVALID'
      );
    }

    const previewIntent = adsCampaignIntentService.buildCampaignIntentFromNormalized(
      readiness.normalized,
      conversionArtifacts,
      { budgetAmountMicros }
    );
    const aiContent = await generateCampaignSlotContent({
      slot,
      businessName: bc.businessName,
      offer: slotPlan.offer,
      action: slotPlan.action,
      places: slotPlan.places,
      websiteUrl: bc.websiteUrl,
      fallbackHeadlines: previewIntent.ad.headlines,
      fallbackDescriptions: previewIntent.ad.descriptions,
      allowedPages: [],
    });

    const slotContentPatch = {};
    if (aiContent?.landingPageUrl) {
      slotContentPatch.page = aiContent.landingPageUrl;
      readiness.normalized.websiteUrl = aiContent.landingPageUrl;
    }
    if (aiContent?.proofLine) {
      slotContentPatch.proofLine = aiContent.proofLine;
    }
    if (Object.keys(slotContentPatch).length > 0) {
      await updateSlot(businessId, slot, slotContentPatch);
    }
    if (Array.isArray(aiContent?.headlines) && aiContent.headlines.filter(Boolean).length >= 3) {
      readiness.normalized.adCopySeeds = {
        ...readiness.normalized.adCopySeeds,
        headlines: aiContent.headlines,
        descriptions:
          Array.isArray(aiContent.descriptions) && aiContent.descriptions.filter(Boolean).length >= 2
            ? aiContent.descriptions
            : readiness.normalized.adCopySeeds.descriptions,
      };
    }

    const currentSusoVersion = typeof bc.susoVersion === 'number' ? bc.susoVersion : 0;

    const { intent, plan: planRow } = await prepareCompliantCampaignPlan({
      setupRunId,
      businessId,
      customerId,
      normalized: readiness.normalized,
      conversionArtifacts,
      budgetAmountMicros,
      slot,
    });

    if (!planRow) {
      throw new AdsProviderPreconditionError('Campaign plan not persisted.', 'ADS_PLAN_PERSIST_FAILED');
    }

    intent.campaign.name = `${intent.campaign.name} (${slot})`;
    if (intent.campaign?.budget?.name) {
      intent.campaign.budget.name = `${intent.campaign.budget.name} (${slot})`;
    }
    const clientCtx = { businessId, customerId, setupRunId: setupRunId.toString(), intent, slot };

    async function ensureResource(logicalKey, artifactType, createFn, metadataBuilder) {
      const scopedKey = `${slot}:${logicalKey}`;
      let existing = await findExistingAdsArtifact({
        setupRunId,
        businessId,
        logicalKey: scopedKey,
        intentFingerprint,
        currentSusoVersion,
      });
      if (!existing && slot === 'recommended') {
        existing = await findExistingAdsArtifact({
          setupRunId,
          businessId,
          logicalKey,
          intentFingerprint,
          currentSusoVersion,
        });
      }
      if (existing) {
        reusedArtifacts += 1;
        return existing.externalId;
      }

      let idempotencyKey = businessScopedIdempotencyKey(
        businessId,
        'google_ads',
        scopedKey,
        intentFingerprint || scopedKey
      );

      let claim = await claimProviderResource({
        setupRunId,
        businessId,
        provider: 'google_ads',
        artifactType,
        idempotencyKey,
        pendingExternalId: `pending:${idempotencyKey}`,
        claimMetadata: { logicalKey: scopedKey, slot, intentFingerprint, susoVersion: currentSusoVersion },
      });

      if (
        !claim.claimed &&
        isCreatedProviderArtifact(claim.artifact) &&
        (String(claim.artifact.setupRunId) !== String(setupRunId) ||
          susoVersionBlocksCrossRunReuse(claim.artifact.metadata?.susoVersion, currentSusoVersion))
      ) {
        idempotencyKey = adsCampaignIdempotencyKey(setupRunId, scopedKey);
        claim = await claimProviderResource({
          setupRunId,
          businessId,
          provider: 'google_ads',
          artifactType,
          idempotencyKey,
          pendingExternalId: `pending:${idempotencyKey}`,
          claimMetadata: { logicalKey: scopedKey, slot, intentFingerprint, susoVersion: currentSusoVersion },
        });
      }

      if (!claim.claimed) {
        if (isCreatedProviderArtifact(claim.artifact)) {
          reusedArtifacts += 1;
          return claim.artifact.externalId;
        }
        const inProgress = await IntegrationArtifact.findOne({ idempotencyKey }).lean();
        if (
          inProgress &&
          inProgress.externalId &&
          !String(inProgress.externalId).startsWith('pending:')
        ) {
          reusedArtifacts += 1;
          return inProgress.externalId;
        }
      }

      let created;
      try {
        created = await createFn();
        await finalizeProviderResourceClaim({
          idempotencyKey,
          externalId: created.resourceName,
          metadataPatch: { logicalKey: scopedKey, slot },
        });
      } catch (err) {
        await markProviderResourceClaimFailed({
          idempotencyKey,
          errorCode: err instanceof GoogleAdsApiError ? err.code : 'GOOGLE_ADS_MUTATE_FAILED',
          errorMessage: err instanceof Error ? err.message : 'mutation failed',
        });
        throw err;
      }

      newArtifacts += 1;
      source = created.source ?? source;

      let crossRunReuseBlocked = false;
      if (intentFingerprint) {
        const candidate = await findReusableArtifact({
          businessId,
          provider: 'google_ads',
          logicalKey: scopedKey,
          fingerprint: intentFingerprint,
        });
        crossRunReuseBlocked = Boolean(
          candidate &&
            susoVersionBlocksCrossRunReuse(candidate.metadata?.susoVersion, currentSusoVersion)
        );
      }

      await persistAdsArtifact({
        setupRunId,
        businessId,
        artifactType,
        logicalKey: scopedKey,
        externalId: created.resourceName,
        intentFingerprint,
        crossRunReuseBlocked,
        metadata: { slot, ...metadataBuilder(created.resourceName) },
      });
      return created.resourceName;
    }

    const budgetResourceName = await ensureResource(
      'campaign_budget',
      'ads_campaign_budget',
      () => createCampaignBudget(clientCtx),
      () => ({
        planId: planRow._id.toString(),
        slot,
        amountMicros: intent.campaign.budget.amountMicros,
        source,
      })
    );

    const campaignResourceName = await ensureResource(
      'campaign',
      'ads_campaign',
      () => createCampaign({ ...clientCtx, budgetResourceName }),
      () => ({
        planId: planRow._id.toString(),
        slot,
        budgetResourceName,
        susoVersion: currentSusoVersion,
        source,
      })
    );

    const adGroupResourceName = await ensureResource(
      'ad_group',
      'ads_ad_group',
      () => createAdGroup({ ...clientCtx, campaignResourceName }),
      () => ({
        planId: planRow._id.toString(),
        slot,
        campaignResourceName,
        keywordPlan: intent.keywords,
        source,
      })
    );

    for (let index = 0; index < intent.keywords.length; index += 1) {
      const keyword = intent.keywords[index];
      await ensureResource(
        `keyword_${index}`,
        'ads_keyword',
        () =>
          createAdGroupKeyword({
            ...clientCtx,
            adGroupResourceName,
            keywordText: keyword.text,
            matchType: keyword.matchType,
            keywordIndex: index,
          }),
        () => ({
          slot,
          adGroupResourceName,
          keywordText: keyword.text,
          matchType: keyword.matchType,
          source,
        })
      );
    }

    for (let index = 0; index < intent.geoTargets.length; index += 1) {
      const geo = intent.geoTargets[index];
      await ensureResource(
        `geo_${index}`,
        'ads_campaign_criterion',
        () =>
          createCampaignGeoTarget({
            ...clientCtx,
            campaignResourceName,
            geoTargetConstant: geo.resourceName,
            geoIndex: index,
          }),
        () => ({ slot, campaignResourceName, geoTargetConstant: geo.resourceName, source })
      );
    }

    const adResourceName = await ensureResource(
      'ad',
      'ads_ad',
      () => createResponsiveSearchAd({ ...clientCtx, adGroupResourceName }),
      () => ({
        slot,
        campaignResourceName,
        adGroupResourceName,
        finalUrl: intent.ad.finalUrl,
        source,
      })
    );

    const slotConversionResource = resolveSlotConversionResource(
      conversionArtifacts,
      customerId,
      slotPlan.action
    );
    if (!slotConversionResource) {
      throw new AdsProviderPreconditionError(
        `Missing ${slotActionToLogicalCategory(slotPlan.action)} conversion for slot ${slot}.`,
        'ADS_MISSING_CONVERSIONS'
      );
    }
    const conversionActionResourceNames = [slotConversionResource];

    const customGoalResourceName = await ensureResource(
      'custom_conversion_goal',
      'ads_custom_conversion_goal',
      () =>
        createCustomConversionGoal({
          ...clientCtx,
          name: `${intent.businessName} — ${slot}`,
          conversionActionResourceNames,
        }),
      () => ({ slot, campaignResourceName, conversionActionResourceNames, source })
    );

    await ensureResource(
      'conversion_goal_campaign_config',
      'ads_conversion_goal_campaign_config',
      () =>
        linkCampaignToCustomConversionGoal({
          ...clientCtx,
          campaignResourceName,
          customConversionGoalResourceName: customGoalResourceName,
        }),
      () => ({ slot, campaignResourceName, customConversionGoalResourceName: customGoalResourceName, source })
    );

    if (slotPlan.action === 'calls') {
      const canonicalPhone = resolveCanonicalPhone(bc);
      if (!canonicalPhone) {
        throw new AdsProviderPreconditionError(
          'A confirmed phone number is required for call campaigns.',
          'ADS_MISSING_CALL_PHONE'
        );
      }

      const callAssetResourceName = await ensureResource(
        'call_asset',
        'ads_asset_call',
        async () => {
          const created = await createCallAssetOnly({
            ...clientCtx,
            phoneNumber: canonicalPhone.nationalNumber,
            countryCode: canonicalPhone.countryCode,
            conversionActionResourceName: slotConversionResource,
          });
          await linkCallAssetToCampaign({
            businessId,
            customerId,
            setupRunId: setupRunId.toString(),
            campaignResourceName,
            assetResourceName: created.assetResourceName,
            slot,
          });
          return { resourceName: created.assetResourceName, source: created.source };
        },
        () => ({
          slot,
          campaignResourceName,
          conversionActionResourceName: slotConversionResource,
          phoneE164: canonicalPhone.e164,
          campaignLinked: true,
          source,
        })
      );
      void callAssetResourceName;
    }

    await CampaignPlan.updateOne({ setupRunId, slot }, { $set: { status: 'applied' } });

    await updateSlot(businessId, slot, {
      providerResourceNames: {
        campaign: campaignResourceName,
        adGroup: adGroupResourceName,
        ad: adResourceName,
        budget: budgetResourceName,
      },
    });

    slotSummaries.push({
      slot,
      campaignResourceName,
      adGroupResourceName,
      adResourceName,
      budgetResourceName,
    });
  }

  logger.info(
    {
      setupRunId: setupRunId.toString(),
      businessId: businessId.toString(),
      stepName: SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
      provider: 'google_ads',
      slots: slotSummaries.map((s) => s.slot),
      newArtifacts,
      reusedArtifacts,
    },
    'lead campaign slots created'
  );

  return {
    idempotent: newArtifacts === 0,
    slotSummaries,
    newArtifacts,
    reusedArtifacts,
    source,
  };
}

module.exports = {
  createLeadCampaignsForSetupRun,
};
