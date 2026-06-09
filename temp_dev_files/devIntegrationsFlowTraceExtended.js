'use strict';

const {
  runDevIntegrationsFlowTrace,
  formatTraceReport,
  TRACEABLE_PROVIDERS,
  DEFAULT_PROVIDER,
  getProviderTraceConfig,
} = require('./devIntegrationsFlowTrace');
const { runGoogleAdsCapabilitiesTrace } = require('./googleAdsCapabilitiesTrace');

/**
 * @param {{
 *   businessId?: string,
 *   userId?: string,
 *   probeTemporal?: boolean,
 *   probeCallbackRoute?: boolean,
 *   ensureSandbox?: boolean,
 *   provider?: string,
 *   oauthOutcome?: string,
 *   oauthReason?: string,
 *   oauthCode?: string,
 *   customerId?: string,
 *   skipReads?: boolean,
 *   skipWrites?: boolean,
 *   includeCampaign?: boolean,
 * }} [options]
 */
async function runDevIntegrationsFlowTraceExtended(options = {}) {
  const baseReport = await runDevIntegrationsFlowTrace(options);
  const extendedStages = [...baseReport.stages];

  if (baseReport.provider !== 'google_ads') {
    extendedStages.push({
      id: 'google_ads_capabilities_skipped',
      label: 'Google Ads read/write capabilities',
      ok: true,
      skipped: true,
      detail: `Skipped for provider=${baseReport.provider} (google_ads only).`,
    });
  } else if (!baseReport.businessId) {
    extendedStages.push({
      id: 'google_ads_capabilities_skipped',
      label: 'Google Ads read/write capabilities',
      ok: false,
      skipped: true,
      detail: 'businessId required for capability checks.',
    });
  } else {
    const { stages: capabilityStages, interpretation } = await runGoogleAdsCapabilitiesTrace({
      businessId: baseReport.businessId,
      customerId: options.customerId,
      skipReads: options.skipReads,
      skipWrites: options.skipWrites,
      includeCampaign: options.includeCampaign,
    });
    extendedStages.push(...capabilityStages);

    if (interpretation) {
      extendedStages.push({
        id: 'google_ads_capabilities_interpretation',
        label: 'Google Ads write interpretation',
        ok: true,
        detail: interpretation,
      });
    }
  }

  const firstFailure = extendedStages.find((s) => !s.ok && !s.skipped) ?? null;

  return {
    ...baseReport,
    stages: extendedStages,
    firstFailure,
    extended: true,
  };
}

/**
 * @param {ReturnType<typeof runDevIntegrationsFlowTraceExtended> extends Promise<infer T> ? T : never} report
 */
function formatExtendedTraceReport(report) {
  const lines = [formatTraceReport(report)];

  const capabilityStages = report.stages.filter((s) =>
    [
      'google_ads_capability_context',
      'read_customer_metadata',
      'read_customer_user_access',
      'read_mcc_customer_client_link',
      'write_campaign_budget',
      'write_conversion_action',
      'write_search_campaign',
      'google_ads_capabilities_interpretation',
      'google_ads_capabilities_skipped',
    ].includes(s.id),
  );

  if (capabilityStages.length > 0) {
    lines.push('');
    lines.push('=== Extended Google Ads Capabilities ===');
    capabilityStages.forEach((s) => {
      const status = s.skipped ? 'SKIP' : s.ok ? 'OK' : 'FAIL';
      lines.push(`  ${s.label} ... ${status}`);
      if (s.detail) lines.push(`    ${s.detail}`);
      if (s.hint) lines.push(`    hint: ${s.hint}`);
    });
  }

  return lines.join('\n');
}

module.exports = {
  TRACEABLE_PROVIDERS,
  DEFAULT_PROVIDER,
  getProviderTraceConfig,
  runDevIntegrationsFlowTraceExtended,
  formatExtendedTraceReport,
};
