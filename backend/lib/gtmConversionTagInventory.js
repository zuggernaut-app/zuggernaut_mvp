'use strict';

const WRONG_LABEL_PATTERNS = [
  /^\d{3,}$/,
  /^mock-ca-/,
];

/**
 * @param {string | null | undefined} value
 */
function isLikelyWrongConversionLabel(value) {
  if (!value || typeof value !== 'string') return true;
  const trimmed = value.trim();
  if (!trimmed) return true;
  return WRONG_LABEL_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * @param {Array<{ key?: string, value?: string }> | null | undefined} params
 * @param {{ bindsToAdsConversionId?: string | null, template?: string | null }} [ctx]
 * @returns {string[]}
 */
function inspectAwctConversionTagParameters(params, ctx = {}) {
  const issues = [];
  if (!Array.isArray(params)) return issues;

  const conversionIdParam = params.find((p) => p?.key === 'conversionId');
  const conversionLabelParam = params.find((p) => p?.key === 'conversionLabel');

  const conversionIdValue = conversionIdParam?.value ?? '';
  if (
    conversionIdValue === '{{Zuggernaut Ads Customer ID}}' ||
    (typeof conversionIdValue === 'string' && /^\d{8,12}$/.test(conversionIdValue.replace(/-/g, '')))
  ) {
    issues.push('uses_ads_customer_id_for_conversion_id');
  }

  const labelValue = conversionLabelParam?.value ?? '';
  if (
    typeof labelValue === 'string' &&
    labelValue.includes('Conversion Label') &&
    labelValue !== '{{Zuggernaut Form Conversion Label}}' &&
    labelValue !== '{{Zuggernaut Call Conversion Label}}' &&
    !labelValue.includes('Form Conversion ID') &&
    !labelValue.includes('Call Conversion ID')
  ) {
    issues.push('legacy_label_variable_reference');
  }

  const boundExternalId = ctx.bindsToAdsConversionId;
  if (boundExternalId && isLikelyWrongConversionLabel(String(boundExternalId))) {
    issues.push('binds_to_api_external_id');
  }

  if (
    typeof labelValue === 'string' &&
    isLikelyWrongConversionLabel(labelValue) &&
    !labelValue.startsWith('{{')
  ) {
    issues.push('literal_api_id_used_as_conversion_label');
  }

  return issues;
}

/**
 * @param {object | null | undefined} artifact — lean IntegrationArtifact row
 * @returns {string[]}
 */
function inspectGtmTagArtifact(artifact) {
  return inspectAwctConversionTagParameters(artifact?.metadata?.gtmPayload?.parameter, {
    bindsToAdsConversionId: artifact?.metadata?.bindsToAdsConversionId ?? null,
    template: artifact?.metadata?.template ?? null,
  });
}

/**
 * @param {object | null | undefined} liveTag — GTM API tag resource
 * @returns {string[]}
 */
function inspectPublishedGtmTag(liveTag) {
  if (!liveTag || liveTag.type !== 'awct') return [];
  if (!String(liveTag.name ?? '').startsWith('Zuggernaut')) return [];

  return inspectAwctConversionTagParameters(liveTag.parameter, {
    template: liveTag.name ?? null,
  });
}

/**
 * @param {{ affected: object[] }} artifactScan
 * @param {{ affected: object[], skipped?: object[] }} publishedScan
 */
function summarizeGtmConversionTagInventory(artifactScan, publishedScan) {
  const affectedArtifacts = [...artifactScan.affected, ...publishedScan.affected];
  const publishedSkipped = publishedScan.skipped?.length ?? 0;
  const provenClean = affectedArtifacts.length === 0 && publishedSkipped === 0;

  return {
    affected: affectedArtifacts.length,
    affectedArtifacts,
    provenClean,
    repairRequired: !provenClean,
  };
}

module.exports = {
  inspectAwctConversionTagParameters,
  inspectGtmTagArtifact,
  inspectPublishedGtmTag,
  isLikelyWrongConversionLabel,
  summarizeGtmConversionTagInventory,
};
