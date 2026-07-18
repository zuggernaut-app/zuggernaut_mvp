'use strict';

const { PROVIDER_MUTATION_CONTRACT, adsCampaignIdempotencyKey } = require('../constants/idempotency');
const { SETUP_STEP_NAMES } = require('../constants/setupWorkflow');
const { ADS_INTENT_CODES, ADS_INTENT_VALIDATION_BUCKETS } = require('../constants/adsCampaignIntent');
const { ARTIFACT_TYPES } = require('../constants/enums');
const {
  resolveAdsCampaignValidationBucket,
} = require('../services/capabilities/adsCampaignIntentService');

describe('Phase 10 definition of done (contract)', () => {
  const setupRunId = '507f1f77bcf86cd799439011';

  it('documents campaign creation artifact types in idempotency contract', () => {
    const contract = PROVIDER_MUTATION_CONTRACT.find(
      (row) => row.stepName === SETUP_STEP_NAMES.ADS_CAMPAIGN_CREATION
    );

    expect(contract?.artifactTypes).toEqual(
      expect.arrayContaining([
        'ads_campaign_budget',
        'ads_campaign',
        'ads_campaign_criterion',
        'ads_ad_group',
        'ads_keyword',
        'ads_ad',
        'ads_custom_conversion_goal',
        'ads_conversion_goal_campaign_config',
      ])
    );
  });

  it('registers Phase 10 artifact types in enums', () => {
    expect(ARTIFACT_TYPES).toEqual(
      expect.arrayContaining(['ads_keyword', 'ads_campaign_criterion'])
    );
  });

  it('maps every ADS_INTENT code to a validation bucket', () => {
    for (const code of Object.values(ADS_INTENT_CODES)) {
      expect(ADS_INTENT_VALIDATION_BUCKETS[code]).toBeTruthy();
      expect(resolveAdsCampaignValidationBucket(code)).toBe(ADS_INTENT_VALIDATION_BUCKETS[code]);
    }
  });

  it('uses stable idempotency keys for geo and keyword logical keys', () => {
    expect(adsCampaignIdempotencyKey(setupRunId, 'geo_0')).toBe(`ads-${setupRunId}-geo_0`);
    expect(adsCampaignIdempotencyKey(setupRunId, 'keyword_0')).toBe(`ads-${setupRunId}-keyword_0`);
  });
});
