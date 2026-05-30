'use strict';

const {
  gtmConversionIdempotencyKey,
  adsCampaignIdempotencyKey,
  adsConversionCatalogIdempotencyKey,
  gtmProvisioningIdempotencyKey,
  adsProvisioningIdempotencyKey,
  PROVIDER_MUTATION_CONTRACT,
} = require('../constants/idempotency');
const { SETUP_STEP_NAMES } = require('../constants/setupWorkflow');

describe('idempotency contract', () => {
  const setupRunId = '507f1f77bcf86cd799439011';
  const businessId = '507f1f77bcf86cd799439012';

  it('builds stable keys for provider-changing activities', () => {
    expect(gtmConversionIdempotencyKey(setupRunId, 'tag_call_conversion')).toBe(
      `gtm-${setupRunId}-tag_call_conversion`
    );
    expect(adsCampaignIdempotencyKey(setupRunId, 'campaign')).toBe(`ads-${setupRunId}-campaign`);
    expect(adsConversionCatalogIdempotencyKey(setupRunId, 'call')).toBe(
      `ads-ca-${setupRunId}-call`
    );
    expect(gtmProvisioningIdempotencyKey(businessId, setupRunId, 'account')).toBe(
      `gtm:account:${businessId}:${setupRunId}`
    );
    expect(adsProvisioningIdempotencyKey(businessId, setupRunId)).toBe(
      `ads:customer:${businessId}:${setupRunId}`
    );
  });

  it('documents every provider-changing setup step', () => {
    const stepNames = PROVIDER_MUTATION_CONTRACT.map((row) => row.stepName);
    expect(stepNames).toEqual(
      expect.arrayContaining([
        SETUP_STEP_NAMES.PROVISION_GTM_RESOURCES,
        SETUP_STEP_NAMES.PROVISION_GOOGLE_ADS_CUSTOMER,
        SETUP_STEP_NAMES.GTM_CONVERSION_SETUP,
        SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION,
        SETUP_STEP_NAMES.ADS_CONVERSION_CATALOG,
      ])
    );
    expect(PROVIDER_MUTATION_CONTRACT.every((row) => row.provider && row.service)).toBe(true);
    expect(PROVIDER_MUTATION_CONTRACT.every((row) => Array.isArray(row.artifactTypes))).toBe(true);
    expect(PROVIDER_MUTATION_CONTRACT.every((row) => typeof row.idempotencyKey === 'function')).toBe(
      true
    );
  });

  it('marks catalog fetch as read-only external despite artifact persistence', () => {
    const catalog = PROVIDER_MUTATION_CONTRACT.find(
      (row) => row.stepName === SETUP_STEP_NAMES.ADS_CONVERSION_CATALOG
    );
    expect(catalog?.readOnlyExternal).toBe(true);
  });
});
