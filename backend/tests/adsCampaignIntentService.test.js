'use strict';

const {
  buildCampaignIntentFromNormalized,
  buildMinimalCampaignIntent,
  buildKeywordsFromSeeds,
  buildBucketValidationFromIssues,
  validateCampaignIntent,
  formatCampaignIntentSummary,
  resolveAdsCampaignValidationBucket,
  formatAdsCampaignPreconditionDetails,
} = require('../services/capabilities/adsCampaignIntentService');
const { ADS_INTENT_CODES, BIDDING_STRATEGY } = require('../constants/adsCampaignIntent');
const { buildMinimalAdsReadyBusinessContext } = require('../services/capabilities/businessContextAdsReadinessService');

function normalizedFixture(overrides = {}) {
  const bc = buildMinimalAdsReadyBusinessContext(overrides);
  const readiness = require('../services/capabilities/businessContextAdsReadinessService').validateBusinessContextAdsReadiness(bc);
  if (!readiness.ok) {
    throw new Error('fixture not ads-ready');
  }
  return readiness.normalized;
}

describe('adsCampaignIntentService', () => {
  it('builds a versioned intent with manual_cpc bidding and structured buckets', () => {
    const intent = buildCampaignIntentFromNormalized(normalizedFixture(), [{ externalId: '1001' }]);

    expect(intent.version).toBe(1);
    expect(intent.campaign.name).toContain('Test Business');
    expect(intent.campaign.channel).toBe('SEARCH');
    expect(intent.campaign.status).toBe('PAUSED');
    expect(intent.campaign.bidding).toBe(BIDDING_STRATEGY.MANUAL_CPC);
    expect(intent.campaign.budget.amountMicros).toBeGreaterThan(0);
    expect(intent.adGroup.type).toBe('SEARCH_STANDARD');
    expect(intent.ad.headlines).toHaveLength(3);
    expect(intent.ad.descriptions).toHaveLength(2);
    expect(intent.keywords.length).toBeGreaterThan(0);
    expect(intent.keywords[0]).toEqual(
      expect.objectContaining({ matchType: 'PHRASE' })
    );
    expect(intent.geoTargetLabels).toEqual(['Mountain View']);
    expect(intent.selectedConversionIds).toEqual(['1001']);
  });

  it('buildKeywordsFromSeeds deduplicates and trims keyword text', () => {
    const keywords = buildKeywordsFromSeeds([
      '  plumbing Springfield  ',
      'plumbing springfield',
      '',
      'plumbing near me',
    ]);

    expect(keywords).toHaveLength(2);
    expect(keywords[0].text).toBe('plumbing Springfield');
    expect(keywords[1].text).toBe('plumbing near me');
  });

  it('buildKeywordsFromSeeds sanitizes invalid symbols from scraped seeds', () => {
    const keywords = buildKeywordsFromSeeds([
      'tax prep & bookkeeping',
      '#1 dentist near me!',
      'HVAC repair/service',
    ]);

    expect(keywords.map((row) => row.text)).toEqual([
      'tax prep bookkeeping',
      '1 dentist near me',
      'HVAC repair service',
    ]);
  });

  it('fails when keywords contain invalid characters after intent build', () => {
    const intent = buildMinimalCampaignIntent({
      keywords: [{ text: 'bad#keyword', matchType: 'PHRASE' }],
    });
    const result = validateCampaignIntent(intent);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ADS_INTENT_CODES.KEYWORD_INVALID_CHARS,
          bucket: 'keywords',
          field: 'keywords[0].text',
        }),
      ])
    );
  });

  it('fails when keywords exceed 10 words', () => {
    const intent = buildMinimalCampaignIntent({
      keywords: [
        {
          text: 'one two three four five six seven eight nine ten eleven',
          matchType: 'PHRASE',
        },
      ],
    });
    const result = validateCampaignIntent(intent);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((row) => row.code === ADS_INTENT_CODES.KEYWORD_TOO_MANY_WORDS)).toBe(true);
  });

  it('passes validation for a minimal valid intent', () => {
    const result = validateCampaignIntent(buildMinimalCampaignIntent());
    expect(result.ok).toBe(true);
  });

  it('fails when campaign name is missing', () => {
    const intent = buildMinimalCampaignIntent({ campaign: { name: '' } });
    const result = validateCampaignIntent(intent);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe(ADS_INTENT_CODES.INVALID_CAMPAIGN_NAME);
  });

  it('fails when bidding is not manual_cpc', () => {
    const intent = buildMinimalCampaignIntent({ campaign: { bidding: 'maximize_conversions' } });
    const result = validateCampaignIntent(intent);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe(ADS_INTENT_CODES.INVALID_BIDDING);
  });

  it('fails when RSA headlines are insufficient', () => {
    const intent = buildMinimalCampaignIntent({ ad: { headlines: ['Only one'] } });
    const result = validateCampaignIntent(intent);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((row) => row.code === ADS_INTENT_CODES.RSA_HEADLINE_COUNT)).toBe(true);
  });

  it('fails when keywords are missing', () => {
    const intent = buildMinimalCampaignIntent({ keywords: [] });
    const result = validateCampaignIntent(intent);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe(ADS_INTENT_CODES.MISSING_KEYWORDS);
  });

  it('fails when geo targets are unresolved', () => {
    const intent = buildMinimalCampaignIntent({ geoTargets: [] });
    const result = validateCampaignIntent(intent);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe(ADS_INTENT_CODES.UNRESOLVED_GEO);
  });

  it('fails when geo target resourceName is invalid', () => {
    const intent = buildMinimalCampaignIntent({
      geoTargets: [{ resourceName: 'invalid', label: 'Springfield' }],
    });
    const result = validateCampaignIntent(intent);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((row) => row.code === ADS_INTENT_CODES.INVALID_GEO_TARGET)).toBe(true);
  });

  it('fails when geo target labels are missing', () => {
    const intent = buildMinimalCampaignIntent({ geoTargetLabels: [] });
    const result = validateCampaignIntent(intent);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe(ADS_INTENT_CODES.MISSING_GEO_TARGET_LABELS);
  });

  it('fails when conversion actions are missing', () => {
    const intent = buildMinimalCampaignIntent({ selectedConversionIds: [] });
    const result = validateCampaignIntent(intent);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe(ADS_INTENT_CODES.MISSING_CONVERSION_ACTIONS);
  });

  it('formatCampaignIntentSummary returns the first issue message', () => {
    const result = validateCampaignIntent(buildMinimalCampaignIntent({ keywords: [] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(formatCampaignIntentSummary(result)).toBe(result.issues[0].message);
  });

  it('resolveAdsCampaignValidationBucket maps intent and readiness codes to buckets', () => {
    expect(resolveAdsCampaignValidationBucket(ADS_INTENT_CODES.RSA_HEADLINE_COUNT)).toBe('ad');
    expect(resolveAdsCampaignValidationBucket(ADS_INTENT_CODES.UNRESOLVED_GEO)).toBe('geo');
    expect(resolveAdsCampaignValidationBucket('ADS_READINESS_MISSING_WEBSITE_URL')).toBe('readiness');
    expect(resolveAdsCampaignValidationBucket('GOOGLE_ADS_MUTATE_FAILED')).toBe('provider');
    expect(resolveAdsCampaignValidationBucket('ADS_MISSING_CONVERSIONS')).toBe('preconditions');
  });

  it('formatAdsCampaignPreconditionDetails surfaces validation bucket for activity errors', () => {
    const details = formatAdsCampaignPreconditionDetails({
      message: 'Responsive search ads require at least 3 unique headlines.',
      code: ADS_INTENT_CODES.RSA_HEADLINE_COUNT,
      field: 'ad.headlines',
      issues: [
        {
          code: ADS_INTENT_CODES.RSA_HEADLINE_COUNT,
          field: 'ad.headlines',
          message: 'Responsive search ads require at least 3 unique headlines.',
          bucket: 'ad',
        },
      ],
    });

    expect(details).toEqual({
      message: 'Responsive search ads require at least 3 unique headlines.',
      code: ADS_INTENT_CODES.RSA_HEADLINE_COUNT,
      validationBucket: 'ad',
      field: 'ad.headlines',
      issues: [
        expect.objectContaining({
          code: ADS_INTENT_CODES.RSA_HEADLINE_COUNT,
          field: 'ad.headlines',
          bucket: 'ad',
        }),
      ],
      bucketValidation: null,
    });
  });

  it('buildBucketValidationFromIssues groups issues by validation bucket', () => {
    const bucketValidation = buildBucketValidationFromIssues([
      {
        code: ADS_INTENT_CODES.RSA_HEADLINE_COUNT,
        field: 'ad.headlines',
        message: 'Need more headlines.',
        bucket: 'ad',
      },
      {
        code: ADS_INTENT_CODES.KEYWORD_INVALID_CHARS,
        field: 'keywords[0].text',
        message: 'Invalid keyword chars.',
        bucket: 'keywords',
      },
    ]);

    expect(bucketValidation.ad.status).toBe('fail');
    expect(bucketValidation.ad.issues).toHaveLength(1);
    expect(bucketValidation.keywords.status).toBe('fail');
    expect(bucketValidation.keywords.issues).toEqual([
      expect.objectContaining({
        code: ADS_INTENT_CODES.KEYWORD_INVALID_CHARS,
        field: 'keywords[0].text',
        message: 'Invalid keyword chars.',
      }),
    ]);
    expect(bucketValidation.campaign.status).toBe('pass');
    expect(bucketValidation.ad_group.status).toBe('pass');
    expect(bucketValidation.geo.status).toBe('pass');
    expect(bucketValidation.conversions.status).toBe('pass');
  });
});
