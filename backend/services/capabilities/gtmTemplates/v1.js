'use strict';

const {
  conversionMeasurementFromAction,
} = require('../../../lib/googleAdsConversionTagSnippets');
const { zugGtmResourceLabel } = require('../../../lib/businessNameKey');

const TEMPLATE_VERSION = 1;

/**
 * @param {string | null | undefined} websiteUrl
 */
function confirmationUrlPattern(websiteUrl) {
  if (websiteUrl) {
    try {
      const u = new URL(websiteUrl);
      return `${u.pathname.replace(/\/$/, '')}/thank`;
    } catch {
      /* use default */
    }
  }
  return '/thank';
}

/**
 * @param {string[] | null | undefined} thankYouUrls
 * @param {string | null | undefined} websiteUrl
 * @returns {string[]}
 */
function confirmationUrlPatterns(thankYouUrls, websiteUrl) {
  if (Array.isArray(thankYouUrls) && thankYouUrls.length > 0) {
    return thankYouUrls.map((raw) => String(raw).trim()).filter(Boolean);
  }
  return [confirmationUrlPattern(websiteUrl)];
}

/**
 * @param {object} artifact — lean IntegrationArtifact row
 * @returns {{ conversionId: string, conversionLabel: string }}
 */
function requireConversionMeasurement(artifact) {
  const fromMetadata =
    artifact?.metadata?.conversionId && artifact?.metadata?.conversionLabel
      ? {
          conversionId: String(artifact.metadata.conversionId),
          conversionLabel: String(artifact.metadata.conversionLabel),
        }
      : conversionMeasurementFromAction({
          conversionId: artifact?.metadata?.conversionId,
          conversionLabel: artifact?.metadata?.conversionLabel,
          tagSnippets: artifact?.metadata?.tagSnippets,
        });

  if (!fromMetadata?.conversionId || !fromMetadata?.conversionLabel) {
    throw new Error(
      `Missing conversion measurement tag snippets for Ads conversion action ${artifact?.externalId ?? 'unknown'}`
    );
  }

  return fromMetadata;
}

/**
 * @param {object} input
 * @param {object[]} input.conversionArtifacts — lean IntegrationArtifact rows
 * @param {string | null | undefined} input.adsCustomerId
 * @param {string | null | undefined} input.websiteUrl
 * @param {string[] | null | undefined} [input.thankYouUrls]
 * @param {string | null | undefined} [input.nameKey]
 */
function buildGtmSetupPlan(input) {
  const { conversionArtifacts, websiteUrl, thankYouUrls, nameKey } = input;
  const n = (label) => zugGtmResourceLabel(nameKey, label);
  const hasCall = conversionArtifacts.some((a) => a.metadata?.logicalCategory === 'call');
  const hasForm = conversionArtifacts.some((a) => a.metadata?.logicalCategory === 'form');
  const callArtifact = conversionArtifacts.find((a) => a.metadata?.logicalCategory === 'call');
  const formArtifact = conversionArtifacts.find((a) => a.metadata?.logicalCategory === 'form');
  const thankYouPatterns = confirmationUrlPatterns(thankYouUrls, websiteUrl);

  /** @type {object[]} */
  const resources = [];

  if (hasForm && formArtifact) {
    const formMeasurement = requireConversionMeasurement(formArtifact);

    resources.push({
      kind: 'variable',
      artifactType: 'gtm_variable',
      logicalKey: 'var_form_conv_id',
      template: 'form_conversion_id_constant',
      displayName: n('Form Conversion ID'),
      bindsToAdsConversionId: formArtifact.externalId,
      gtmPayload: {
        name: n('Form Conversion ID'),
        type: 'c',
        parameter: [{ type: 'template', key: 'value', value: formMeasurement.conversionId }],
      },
    });

    resources.push({
      kind: 'variable',
      artifactType: 'gtm_variable',
      logicalKey: 'var_form_conv_label',
      template: 'form_conversion_label_constant',
      displayName: n('Form Conversion Label'),
      bindsToAdsConversionId: formArtifact.externalId,
      gtmPayload: {
        name: n('Form Conversion Label'),
        type: 'c',
        parameter: [{ type: 'template', key: 'value', value: formMeasurement.conversionLabel }],
      },
    });

    /** @type {string[]} */
    const formConfirmationTriggerKeys = [];
    thankYouPatterns.forEach((pattern, index) => {
      const logicalKey =
        thankYouPatterns.length === 1
          ? 'trig_form_confirmation_url'
          : `trig_form_confirmation_url_${index}`;
      formConfirmationTriggerKeys.push(logicalKey);
      resources.push({
        kind: 'trigger',
        artifactType: 'gtm_trigger',
        logicalKey,
        template: 'form_confirmation_page_url',
        displayName:
          thankYouPatterns.length === 1
            ? n('Form Confirmation Page')
            : `${n('Form Confirmation Page')} ${index + 1}`,
        gtmPayload: {
          name:
            thankYouPatterns.length === 1
              ? n('Form Confirmation Page')
              : `${n('Form Confirmation Page')} ${index + 1}`,
          type: 'pageview',
          filter: [
            {
              type: 'contains',
              parameter: [
                { type: 'template', key: 'arg0', value: '{{Page URL}}' },
                { type: 'template', key: 'arg1', value: pattern },
              ],
            },
          ],
        },
      });
    });

    resources.push({
      kind: 'trigger',
      artifactType: 'gtm_trigger',
      logicalKey: 'trig_form_submit',
      template: 'form_submission',
      displayName: n('Form Submit'),
      gtmPayload: {
        name: n('Form Submit'),
        type: 'formSubmission',
      },
    });
    resources.push({
      kind: 'tag',
      artifactType: 'gtm_tag',
      logicalKey: 'tag_form_conversion',
      template: 'ads_conversion_form',
      displayName: n('Form Conversion'),
      bindsToAdsConversionId: formArtifact.externalId,
      firingTriggerLogicalKeys: [...formConfirmationTriggerKeys, 'trig_form_submit'],
      gtmPayload: {
        name: n('Form Conversion'),
        type: 'awct',
        parameter: [
          { type: 'template', key: 'conversionId', value: `{{${n('Form Conversion ID')}}}` },
          { type: 'template', key: 'conversionLabel', value: `{{${n('Form Conversion Label')}}}` },
        ],
      },
    });
  }

  if (hasCall && callArtifact) {
    const callMeasurement = requireConversionMeasurement(callArtifact);

    resources.push({
      kind: 'variable',
      artifactType: 'gtm_variable',
      logicalKey: 'var_call_conv_id',
      template: 'call_conversion_id_constant',
      displayName: n('Call Conversion ID'),
      bindsToAdsConversionId: callArtifact.externalId,
      gtmPayload: {
        name: n('Call Conversion ID'),
        type: 'c',
        parameter: [{ type: 'template', key: 'value', value: callMeasurement.conversionId }],
      },
    });

    resources.push({
      kind: 'variable',
      artifactType: 'gtm_variable',
      logicalKey: 'var_call_conv_label',
      template: 'call_conversion_label_constant',
      displayName: n('Call Conversion Label'),
      bindsToAdsConversionId: callArtifact.externalId,
      gtmPayload: {
        name: n('Call Conversion Label'),
        type: 'c',
        parameter: [{ type: 'template', key: 'value', value: callMeasurement.conversionLabel }],
      },
    });
    resources.push({
      kind: 'trigger',
      artifactType: 'gtm_trigger',
      logicalKey: 'trig_call_tel_click',
      template: 'call_tel_click',
      displayName: n('Call Tel Click'),
      gtmPayload: {
        name: n('Call Tel Click'),
        type: 'click',
        filter: [
          {
            type: 'contains',
            parameter: [
              { type: 'template', key: 'arg0', value: '{{Click URL}}' },
              { type: 'template', key: 'arg1', value: 'tel:' },
            ],
          },
        ],
      },
    });
    resources.push({
      kind: 'tag',
      artifactType: 'gtm_tag',
      logicalKey: 'tag_call_conversion',
      template: 'ads_conversion_call',
      displayName: n('Call Conversion'),
      bindsToAdsConversionId: callArtifact.externalId,
      firingTriggerLogicalKeys: ['trig_call_tel_click'],
      gtmPayload: {
        name: n('Call Conversion'),
        type: 'awct',
        parameter: [
          { type: 'template', key: 'conversionId', value: `{{${n('Call Conversion ID')}}}` },
          { type: 'template', key: 'conversionLabel', value: `{{${n('Call Conversion Label')}}}` },
        ],
      },
    });
  }

  return { templateVersion: TEMPLATE_VERSION, resources };
}

module.exports = {
  TEMPLATE_VERSION,
  buildGtmSetupPlan,
  confirmationUrlPattern,
  confirmationUrlPatterns,
  requireConversionMeasurement,
};
