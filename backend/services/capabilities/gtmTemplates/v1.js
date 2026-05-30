'use strict';

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
 * @param {object} input
 * @param {object[]} input.conversionArtifacts — lean IntegrationArtifact rows
 * @param {string | null | undefined} input.adsCustomerId
 * @param {string | null | undefined} input.websiteUrl
 */
function buildGtmSetupPlan(input) {
  const { conversionArtifacts, adsCustomerId, websiteUrl } = input;
  const hasCall = conversionArtifacts.some((a) => a.metadata?.logicalCategory === 'call');
  const hasForm = conversionArtifacts.some((a) => a.metadata?.logicalCategory === 'form');
  const callArtifact = conversionArtifacts.find((a) => a.metadata?.logicalCategory === 'call');
  const formArtifact = conversionArtifacts.find((a) => a.metadata?.logicalCategory === 'form');
  const customerDigits = adsCustomerId ? String(adsCustomerId).replace(/-/g, '') : '';
  const confirmationPattern = confirmationUrlPattern(websiteUrl);

  /** @type {object[]} */
  const resources = [];

  resources.push({
    kind: 'variable',
    artifactType: 'gtm_variable',
    logicalKey: 'var_ads_customer_id',
    template: 'ads_customer_id_constant',
    displayName: 'Zuggernaut Ads Customer ID',
    gtmPayload: {
      name: 'Zuggernaut Ads Customer ID',
      type: 'c',
      parameter: [{ type: 'template', key: 'value', value: customerDigits }],
    },
  });

  if (hasForm && formArtifact) {
    resources.push({
      kind: 'variable',
      artifactType: 'gtm_variable',
      logicalKey: 'var_form_conv_label',
      template: 'form_conversion_label_constant',
      displayName: 'Zuggernaut Form Conversion Label',
      bindsToAdsConversionId: formArtifact.externalId,
      gtmPayload: {
        name: 'Zuggernaut Form Conversion Label',
        type: 'c',
        parameter: [{ type: 'template', key: 'value', value: formArtifact.externalId }],
      },
    });
    resources.push({
      kind: 'trigger',
      artifactType: 'gtm_trigger',
      logicalKey: 'trig_form_confirmation_url',
      template: 'form_confirmation_page_url',
      displayName: 'Zuggernaut Form Confirmation Page',
      gtmPayload: {
        name: 'Zuggernaut Form Confirmation Page',
        type: 'pageview',
        filter: [
          {
            type: 'contains',
            parameter: [
              { type: 'template', key: 'arg0', value: '{{Page URL}}' },
              { type: 'template', key: 'arg1', value: confirmationPattern },
            ],
          },
        ],
      },
    });
    resources.push({
      kind: 'trigger',
      artifactType: 'gtm_trigger',
      logicalKey: 'trig_form_submit_click',
      template: 'form_submit_click',
      displayName: 'Zuggernaut Form Submit Click',
      gtmPayload: {
        name: 'Zuggernaut Form Submit Click',
        type: 'click',
        filter: [
          {
            type: 'matchRegex',
            parameter: [
              { type: 'template', key: 'arg0', value: '{{Click Element}}' },
              { type: 'template', key: 'arg1', value: '^(BUTTON|INPUT)$' },
            ],
          },
        ],
      },
    });
    resources.push({
      kind: 'tag',
      artifactType: 'gtm_tag',
      logicalKey: 'tag_form_conversion',
      template: 'ads_conversion_form',
      displayName: 'Zuggernaut Form Conversion',
      bindsToAdsConversionId: formArtifact.externalId,
      firingTriggerLogicalKeys: ['trig_form_confirmation_url', 'trig_form_submit_click'],
      gtmPayload: {
        name: 'Zuggernaut Form Conversion',
        type: 'awct',
        parameter: [
          { type: 'template', key: 'conversionId', value: '{{Zuggernaut Ads Customer ID}}' },
          { type: 'template', key: 'conversionLabel', value: '{{Zuggernaut Form Conversion Label}}' },
        ],
      },
    });
  }

  if (hasCall && callArtifact) {
    resources.push({
      kind: 'variable',
      artifactType: 'gtm_variable',
      logicalKey: 'var_call_conv_label',
      template: 'call_conversion_label_constant',
      displayName: 'Zuggernaut Call Conversion Label',
      bindsToAdsConversionId: callArtifact.externalId,
      gtmPayload: {
        name: 'Zuggernaut Call Conversion Label',
        type: 'c',
        parameter: [{ type: 'template', key: 'value', value: callArtifact.externalId }],
      },
    });
    resources.push({
      kind: 'trigger',
      artifactType: 'gtm_trigger',
      logicalKey: 'trig_call_tel_click',
      template: 'call_tel_click',
      displayName: 'Zuggernaut Call Tel Click',
      gtmPayload: {
        name: 'Zuggernaut Call Tel Click',
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
      kind: 'trigger',
      artifactType: 'gtm_trigger',
      logicalKey: 'trig_call_element_hint_click',
      template: 'call_element_hint_click',
      displayName: 'Zuggernaut Call Element Hint Click',
      gtmPayload: {
        name: 'Zuggernaut Call Element Hint Click',
        type: 'click',
        filter: [
          {
            type: 'matchRegex',
            parameter: [
              { type: 'template', key: 'arg0', value: '{{Click Text}}' },
              { type: 'template', key: 'arg1', value: '(?i).*(call|phone|tel).*$' },
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
      displayName: 'Zuggernaut Call Conversion',
      bindsToAdsConversionId: callArtifact.externalId,
      firingTriggerLogicalKeys: ['trig_call_tel_click', 'trig_call_element_hint_click'],
      gtmPayload: {
        name: 'Zuggernaut Call Conversion',
        type: 'awct',
        parameter: [
          { type: 'template', key: 'conversionId', value: '{{Zuggernaut Ads Customer ID}}' },
          { type: 'template', key: 'conversionLabel', value: '{{Zuggernaut Call Conversion Label}}' },
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
};
