'use strict';

const mongoose = require('mongoose');
const { SETUP_STEP_NAMES } = require('../../constants/setupWorkflow');
const { ssrfSafeGet, SsrfError } = require('../../lib/ssrf');
const { buildGtmSetupPlan } = require('./gtmTemplates/v1');
const { loadSetupReadyConnection } = require('./setupReadyConnectionService');
const { getConnectionStatus } = require('./integrationConnectionService');
const { resolveHeadlessStatusFromLatestScrape } = require('./businessContextAdsReadinessService');
const IntegrationArtifact = mongoose.model('IntegrationArtifact');
const IntegrationConnection = mongoose.model('IntegrationConnection');
const ProviderSnapshot = mongoose.model('ProviderSnapshot');
const BusinessContext = mongoose.model('BusinessContext');

/**
 * @param {object | null | undefined} gtmIds — normalized GTM identifiers
 */
function resolvePublicContainerId(gtmIds) {
  if (!gtmIds || typeof gtmIds !== 'object') return null;
  return gtmIds.publicContainerId ?? gtmIds.containerPublicId ?? gtmIds.gtmId ?? null;
}

/**
 * @param {object[]} conversionArtifacts
 * @param {string | null | undefined} websiteUrl
 */
function computeExpectedStructure(conversionArtifacts, websiteUrl, thankYouUrls) {
  const plan = buildGtmSetupPlan({
    conversionArtifacts,
    adsCustomerId: '0',
    websiteUrl: websiteUrl ?? null,
    thankYouUrls: thankYouUrls ?? [],
  });

  return {
    adsConversions: conversionArtifacts.length,
    gtmTags: plan.resources.filter((r) => r.artifactType === 'gtm_tag').length,
    gtmTriggers: plan.resources.filter((r) => r.artifactType === 'gtm_trigger').length,
    gtmVariables: plan.resources.filter((r) => r.artifactType === 'gtm_variable').length,
    publishedContainerVersion: true,
  };
}

/**
 * @param {string} html
 * @param {string} publicContainerId
 */
function detectSnippetInHtml(html, publicContainerId) {
  const id = String(publicContainerId);
  const hasPublic = html.includes(id);
  const hasGtmLoader = html.includes('googletagmanager.com/gtm.js');
  const hasNoscriptIframe =
    html.includes('googletagmanager.com/ns.html') && html.includes(id);
  return hasPublic || hasGtmLoader || hasNoscriptIframe;
}

/**
 * @param {object[]} adsConversions
 * @param {object[]} gtmTags
 * @param {object[]} gtmTriggers
 */
function verifyAdsConversionLinkage(adsConversions, gtmTags, gtmTriggers) {
  const missing = [];
  const triggerTemplates = new Set(
    gtmTriggers.map((t) => t.metadata?.template).filter(Boolean)
  );

  for (const conv of adsConversions) {
    const tag = gtmTags.find((t) => t.metadata?.bindsToAdsConversionId === conv.externalId);
    if (!tag) {
      missing.push(`gtm_tag_for_${conv.externalId}`);
      continue;
    }

    const category = conv.metadata?.logicalCategory;
    if (category === 'call') {
      if (!triggerTemplates.has('call_tel_click')) missing.push('call_tel_trigger');
    }
    if (category === 'form') {
      if (!triggerTemplates.has('form_confirmation_page_url')) missing.push('form_url_trigger');
      if (!triggerTemplates.has('form_submission')) missing.push('form_submit_trigger');
    }

    const firingKeys = tag.metadata?.firingTriggerLogicalKeys;
    if (!Array.isArray(firingKeys) || firingKeys.length === 0) {
      missing.push(`tag_triggers_for_${conv.externalId}`);
    }
  }

  return missing;
}

/**
 * @param {object} expected
 * @param {object} actual
 * @param {string[]} linkageMissing
 */
function collectStructuralMissing(expected, actual, linkageMissing) {
  const missing = [];
  if (actual.adsConversions < expected.adsConversions) missing.push('ads_conversions');
  if (actual.gtmTags < expected.gtmTags) missing.push('gtm_tags');
  if (actual.gtmTriggers < expected.gtmTriggers) missing.push('gtm_triggers');
  if (actual.gtmVariables < expected.gtmVariables) missing.push('gtm_variables');
  if (expected.publishedContainerVersion && !actual.publishedContainerVersion) {
    missing.push('published_container_version');
  }
  missing.push(...linkageMissing);
  return missing;
}

/**
 * @param {object} ctx
 * @param {import('mongoose').Types.ObjectId} ctx.setupRunId
 * @param {import('mongoose').Types.ObjectId} ctx.businessId
 * @param {import('pino').Logger} ctx.logger
 * @returns {Promise<{ result: 'pass' | 'snippet_pending' | 'needs_tracking_fix' | 'manual_review_required', evidence: object, summary: string }>}
 */
async function runStructuralVerification(ctx) {
  const { setupRunId, businessId, logger } = ctx;
  const scrapeHeadlessStatus = await resolveHeadlessStatusFromLatestScrape(businessId);
  const scrapeCompletenessEvidence =
    scrapeHeadlessStatus === 'disabled_ssrf'
      ? {
          headlessStatus: 'disabled_ssrf',
          scrapeCompletenessNote:
            'Onboarding used static scraping only; headless browsing was disabled for security policies.',
        }
      : {};

  const gtmStatus = await getConnectionStatus(businessId, 'gtm');
  if (!gtmStatus.ready) {
    return {
      result: 'skipped',
      evidence: {
        gtmOptional: true,
        reason: gtmStatus.reason,
        nextAction: gtmStatus.nextAction,
        ...scrapeCompletenessEvidence,
      },
      summary: 'GTM is not configured; structural verification skipped.',
    };
  }

  const bc = await BusinessContext.findOne({ businessId }).lean();
  const websiteUrl = bc?.websiteUrl?.trim() ?? null;
  const thankYouUrls = Array.isArray(bc?.thankYouUrls) ? bc.thankYouUrls : [];

  const adsConversions = await IntegrationArtifact.find({
    setupRunId,
    businessId,
    provider: 'google_ads',
    artifactType: 'ads_conversion_action',
  }).lean();

  const gtmTags = await IntegrationArtifact.find({
    setupRunId,
    businessId,
    provider: 'gtm',
    artifactType: 'gtm_tag',
  }).lean();

  const gtmTriggers = await IntegrationArtifact.find({
    setupRunId,
    businessId,
    provider: 'gtm',
    artifactType: 'gtm_trigger',
  }).lean();

  const gtmVariables = await IntegrationArtifact.find({
    setupRunId,
    businessId,
    provider: 'gtm',
    artifactType: 'gtm_variable',
  }).lean();

  const containerVersionSnap = await ProviderSnapshot.findOne({
    setupRunId,
    businessId,
    provider: 'gtm',
    snapshotType: 'gtm_container_version',
  }).lean();

  let publicContainerId = null;
  try {
    const gtmReady = await loadSetupReadyConnection(businessId, 'gtm');
    publicContainerId = resolvePublicContainerId(gtmReady.gtmIds);
  } catch {
    const gtmConn = await IntegrationConnection.findOne({ businessId, provider: 'gtm' }).lean();
    publicContainerId = resolvePublicContainerId(gtmConn?.providerIdentifiers ?? null);
  }

  const expected = computeExpectedStructure(adsConversions, websiteUrl, thankYouUrls);
  const actual = {
    adsConversions: adsConversions.length,
    gtmTags: gtmTags.length,
    gtmTriggers: gtmTriggers.length,
    gtmVariables: gtmVariables.length,
    publishedContainerVersion: Boolean(containerVersionSnap?.payload?.publishedVersionPath),
  };

  const linkageMissing = verifyAdsConversionLinkage(adsConversions, gtmTags, gtmTriggers);
  const structuralMissing = collectStructuralMissing(expected, actual, linkageMissing);

  const evidence = {
    websiteUrl,
    publicContainerId,
    snippetChecked: false,
    snippetPresent: null,
    expected,
    actual,
    missing: [],
    ...scrapeCompletenessEvidence,
  };

  if (!websiteUrl) {
    evidence.missing = ['website_url'];
    return {
      result: 'manual_review_required',
      evidence,
      summary: 'No website URL on BusinessContext; cannot verify GTM snippet.',
    };
  }

  if (!publicContainerId) {
    evidence.missing = ['public_container_id'];
    return {
      result: 'manual_review_required',
      evidence,
      summary: 'Cannot verify GTM snippet without a public container id on the GTM connection.',
    };
  }

  if (structuralMissing.length > 0) {
    evidence.missing = structuralMissing;
    return {
      result: 'needs_tracking_fix',
      evidence,
      summary: `Structural verification failed: ${structuralMissing.join(', ')}.`,
    };
  }

  evidence.snippetChecked = true;
  try {
    const res = await ssrfSafeGet(websiteUrl, {
      timeout: 15000,
      maxRedirects: 5,
      maxContentLength: 2 * 1024 * 1024,
      validateStatus: () => true,
      headers: { Accept: 'text/html,*/*' },
      responseType: 'text',
    });
    const html = typeof res.data === 'string' ? res.data : '';
    evidence.snippetPresent = detectSnippetInHtml(html, publicContainerId);

    if (!evidence.snippetPresent) {
      evidence.missing = ['snippet'];
      return {
        result: 'snippet_pending',
        evidence,
        summary:
          'GTM container is configured but the snippet was not detected on the business website. Install the GTM snippet in the site <head>, then refresh or start a new setup run.',
      };
    }
  } catch (err) {
    const msg =
      err instanceof SsrfError
        ? err.code || 'ssrf_blocked'
        : err instanceof Error
          ? err.message
          : 'fetch_error';
    evidence.missing = ['website_fetch'];
    return {
      result: 'manual_review_required',
      evidence: { ...evidence, fetchError: msg },
      summary: 'Website could not be fetched for structural verification.',
    };
  }

  logger.info(
    {
      setupRunId: setupRunId.toString(),
      businessId: businessId.toString(),
      stepName: SETUP_STEP_NAMES.STRUCTURAL_VERIFICATION,
      provider: 'gtm',
    },
    'structural verification passed'
  );

  evidence.missing = [];
  return { result: 'pass', evidence, summary: 'Structural verification passed.' };
}

module.exports = {
  runStructuralVerification,
  resolvePublicContainerId,
  computeExpectedStructure,
  detectSnippetInHtml,
  verifyAdsConversionLinkage,
  collectStructuralMissing,
};
