'use strict';

const { PROVIDER_MUTATION_CONTRACT, adsCampaignIdempotencyKey } = require('../constants/idempotency');
const { SETUP_STEP_NAMES } = require('../constants/setupWorkflow');
const { ADS_INTENT_CODES, ADS_INTENT_VALIDATION_BUCKETS } = require('../constants/adsCampaignIntent');
const { ARTIFACT_TYPES } = require('../constants/enums');
const {
  createEmptyBucketValidation,
  resolveAdsCampaignValidationBucket,
} = require('../services/capabilities/adsCampaignIntentService');
const googleAdsCampaignComplianceService = require('../services/capabilities/googleAdsCampaignComplianceService');

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

  it('covers every required Phase 10 validation bucket', () => {
    const requiredBuckets = ['campaign', 'ad_group', 'ad', 'keywords', 'geo', 'conversions'];
    const mappedBuckets = new Set(Object.values(ADS_INTENT_VALIDATION_BUCKETS));
    const emptyBucketValidation = createEmptyBucketValidation('pass');

    for (const bucket of requiredBuckets) {
      expect(mappedBuckets.has(bucket)).toBe(true);
      expect(emptyBucketValidation).toHaveProperty(bucket);
      expect(emptyBucketValidation[bucket]).toEqual({ status: 'pass', issues: [] });
    }
  });

  it('resolves representative compliance codes for all required buckets', () => {
    const representativeCodesByBucket = {
      campaign: [
        ADS_INTENT_CODES.INVALID_CAMPAIGN_NAME,
        ADS_INTENT_CODES.INVALID_BUDGET_AMOUNT,
        ADS_INTENT_CODES.INVALID_BIDDING,
      ],
      ad_group: [
        ADS_INTENT_CODES.INVALID_AD_GROUP_NAME,
        ADS_INTENT_CODES.INVALID_AD_GROUP_TYPE,
        ADS_INTENT_CODES.INVALID_AD_GROUP_STATUS,
      ],
      ad: [
        ADS_INTENT_CODES.INVALID_FINAL_URL,
        ADS_INTENT_CODES.RSA_HEADLINE_COUNT,
        ADS_INTENT_CODES.RSA_DESCRIPTION_COUNT,
      ],
      keywords: [
        ADS_INTENT_CODES.KEYWORD_INVALID_CHARS,
        ADS_INTENT_CODES.KEYWORD_TOO_MANY_WORDS,
        ADS_INTENT_CODES.MISSING_KEYWORDS,
      ],
      geo: [
        ADS_INTENT_CODES.MISSING_GEO_TARGET_LABELS,
        ADS_INTENT_CODES.UNRESOLVED_GEO,
        ADS_INTENT_CODES.INVALID_GEO_TARGET,
      ],
      conversions: [ADS_INTENT_CODES.MISSING_CONVERSION_ACTIONS],
    };

    for (const [bucket, codes] of Object.entries(representativeCodesByBucket)) {
      for (const code of codes) {
        expect(resolveAdsCampaignValidationBucket(code)).toBe(bucket);
      }
    }
  });

  it('exposes deterministic keyword compliance validation before campaign mutation', () => {
    expect(googleAdsCampaignComplianceService).toEqual(
      expect.objectContaining({
        assertGoogleAdsCampaignCompliance: expect.any(Function),
        validateKeywordCompliance: expect.any(Function),
        sanitizeKeywordSeeds: expect.any(Function),
      })
    );
  });

  it('uses stable idempotency keys for geo and keyword logical keys', () => {
    expect(adsCampaignIdempotencyKey(setupRunId, 'geo_0')).toBe(`ads-${setupRunId}-geo_0`);
    expect(adsCampaignIdempotencyKey(setupRunId, 'keyword_0')).toBe(`ads-${setupRunId}-keyword_0`);
  });
});
