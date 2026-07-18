'use strict';

const {
  validateBusinessContextAdsReadiness,
  buildMinimalAdsReadyBusinessContext,
  formatAdsReadinessSummary,
} = require('../services/capabilities/businessContextAdsReadinessService');
const { ADS_READINESS_CODES } = require('../constants/businessContextAdsReadiness');

describe('businessContextAdsReadinessService', () => {
  it('passes when required Ads inputs are present', () => {
    const result = validateBusinessContextAdsReadiness(buildMinimalAdsReadyBusinessContext());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.normalized.businessName).toBe('Test Business');
    expect(result.normalized.websiteUrl).toBe('https://example.com');
    expect(result.normalized.primaryService).toBe('Example service');
    expect(result.normalized.primaryServiceArea).toBe('Mountain View');
    expect(result.normalized.resolvedPrimaryGoal).toBe('both');
    expect(result.normalized.keywordSeeds).toHaveLength(3);
    expect(result.normalized.adCopySeeds.headlines).toHaveLength(3);
    expect(result.normalized.adCopySeeds.descriptions).toHaveLength(2);
  });

  it('accepts industry when services are empty', () => {
    const result = validateBusinessContextAdsReadiness(
      buildMinimalAdsReadyBusinessContext({
        services: [],
        industry: 'Plumbing',
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.normalized.primaryService).toBe('Plumbing');
  });

  it('fails when website URL is missing', () => {
    const result = validateBusinessContextAdsReadiness(
      buildMinimalAdsReadyBusinessContext({ websiteUrl: '' })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe(ADS_READINESS_CODES.MISSING_WEBSITE_URL);
  });

  it('fails when website URL is invalid', () => {
    const result = validateBusinessContextAdsReadiness(
      buildMinimalAdsReadyBusinessContext({ websiteUrl: 'not-a-url' })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.code === ADS_READINESS_CODES.INVALID_WEBSITE_URL)).toBe(true);
  });

  it('fails when business name is missing', () => {
    const result = validateBusinessContextAdsReadiness(
      buildMinimalAdsReadyBusinessContext({ businessName: '' })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe(ADS_READINESS_CODES.MISSING_BUSINESS_NAME);
  });

  it('fails when services and industry are missing', () => {
    const result = validateBusinessContextAdsReadiness(
      buildMinimalAdsReadyBusinessContext({ services: [], industry: '' })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.code === ADS_READINESS_CODES.MISSING_SERVICES)).toBe(true);
  });

  it('fails when service areas are missing', () => {
    const result = validateBusinessContextAdsReadiness(
      buildMinimalAdsReadyBusinessContext({ serviceAreas: [] })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe(ADS_READINESS_CODES.MISSING_SERVICE_AREAS);
  });

  it('fails when goals primary is missing', () => {
    const result = validateBusinessContextAdsReadiness(
      buildMinimalAdsReadyBusinessContext({ goals: {} })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe(ADS_READINESS_CODES.MISSING_GOALS);
  });

  it('fails when goals primary is unsupported', () => {
    const result = validateBusinessContextAdsReadiness(
      buildMinimalAdsReadyBusinessContext({ goals: { primary: 'traffic' } })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe(ADS_READINESS_CODES.UNSUPPORTED_GOAL);
  });

  it('normalizes placeholder service areas for geo suggest', () => {
    const tbd = validateBusinessContextAdsReadiness(
      buildMinimalAdsReadyBusinessContext({ serviceAreas: ['Service area TBD'] })
    );
    expect(tbd.ok).toBe(true);
    if (!tbd.ok) return;
    expect(tbd.normalized.primaryServiceArea).toBe('Mountain View');

    const localServices = validateBusinessContextAdsReadiness(
      buildMinimalAdsReadyBusinessContext({ serviceAreas: ['Local services'] })
    );
    expect(localServices.ok).toBe(true);
    if (!localServices.ok) return;
    expect(localServices.normalized.primaryServiceArea).toBe('Mountain View');

    const hostArea = validateBusinessContextAdsReadiness(
      buildMinimalAdsReadyBusinessContext({ serviceAreas: ['miosalon.com area'] })
    );
    expect(hostArea.ok).toBe(true);
    if (!hostArea.ok) return;
    expect(hostArea.normalized.primaryServiceArea).toBe('Mountain View');
  });

  it('formatAdsReadinessSummary returns first issue message', () => {
    const result = validateBusinessContextAdsReadiness({ businessName: 'Acme' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(formatAdsReadinessSummary(result)).toBe(result.issues[0].message);
  });
});
