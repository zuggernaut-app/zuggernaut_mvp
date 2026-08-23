'use strict';

const {
  validateBusinessContextAdsReadiness,
  validateBusinessContextAdsReadinessSync,
  buildMinimalAdsReadyBusinessContext,
  formatAdsReadinessSummary,
  normalizeBusinessNameForAds,
} = require('../services/capabilities/businessContextAdsReadinessService');
const { ADS_READINESS_CODES } = require('../constants/businessContextAdsReadiness');

describe('businessContextAdsReadinessService', () => {
  it('passes when required Ads inputs are present', () => {
    const result = validateBusinessContextAdsReadinessSync(buildMinimalAdsReadyBusinessContext());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.normalized.businessName).toBe('Test Business');
    expect(result.normalized.websiteUrl).toBe('https://example.com');
    expect(result.normalized.primaryService).toBe('Example service');
    expect(result.normalized.primaryServiceArea).toBe('San Francisco');
    expect(result.normalized.resolvedPrimaryGoal).toBe('both');
    expect(result.normalized.keywordSeeds).toHaveLength(3);
    expect(result.normalized.adCopySeeds.headlines).toHaveLength(3);
    expect(result.normalized.adCopySeeds.descriptions).toHaveLength(2);
  });

  it('accepts industry when services are empty', () => {
    const result = validateBusinessContextAdsReadinessSync(
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
    const result = validateBusinessContextAdsReadinessSync(
      buildMinimalAdsReadyBusinessContext({ websiteUrl: '' })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe(ADS_READINESS_CODES.MISSING_WEBSITE_URL);
  });

  it('fails when website URL is invalid', () => {
    const result = validateBusinessContextAdsReadinessSync(
      buildMinimalAdsReadyBusinessContext({ websiteUrl: 'not-a-url' })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.code === ADS_READINESS_CODES.INVALID_WEBSITE_URL)).toBe(true);
  });

  it('fails when business name is missing', () => {
    const result = validateBusinessContextAdsReadinessSync(
      buildMinimalAdsReadyBusinessContext({ businessName: '' })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe(ADS_READINESS_CODES.MISSING_BUSINESS_NAME);
  });

  it('fails when services and industry are missing', () => {
    const result = validateBusinessContextAdsReadinessSync(
      buildMinimalAdsReadyBusinessContext({ services: [], industry: '' })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.some((i) => i.code === ADS_READINESS_CODES.MISSING_SERVICES)).toBe(true);
  });

  it('fails when service areas are missing', () => {
    const result = validateBusinessContextAdsReadinessSync(
      buildMinimalAdsReadyBusinessContext({ serviceAreas: [] })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe(ADS_READINESS_CODES.MISSING_SERVICE_AREAS);
  });

  it('fails when goals primary is missing', () => {
    const result = validateBusinessContextAdsReadinessSync(
      buildMinimalAdsReadyBusinessContext({ goals: {} })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe(ADS_READINESS_CODES.MISSING_GOALS);
  });

  it('fails when goals primary is unsupported', () => {
    const result = validateBusinessContextAdsReadinessSync(
      buildMinimalAdsReadyBusinessContext({ goals: { primary: 'traffic' } })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe(ADS_READINESS_CODES.UNSUPPORTED_GOAL);
  });

  it('fails when service area is a placeholder label', () => {
    const placeholderCases = [
      'Service area TBD',
      'Local services',
      'miosalon.com area',
    ];

    for (const serviceArea of placeholderCases) {
      const result = validateBusinessContextAdsReadinessSync(
        buildMinimalAdsReadyBusinessContext({ serviceAreas: [serviceArea] })
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.issues[0].code).toBe(ADS_READINESS_CODES.PLACEHOLDER_SERVICE_AREA);
      expect(result.issues[0].message).toMatch(/confirm a real city or region/i);
    }
  });

  it('accepts real service area labels without spoofing geo targets', () => {
    const result = validateBusinessContextAdsReadinessSync(
      buildMinimalAdsReadyBusinessContext({ serviceAreas: ['Bay Area'] })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.normalized.primaryServiceArea).toBe('Bay Area');
  });

  it('formatAdsReadinessSummary returns first issue message', () => {
    const result = validateBusinessContextAdsReadinessSync({ businessName: 'Acme' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(formatAdsReadinessSummary(result)).toBe(result.issues[0].message);
  });

  describe('normalizeBusinessNameForAds', () => {
    it('uses first comma-separated segment and strips special characters', () => {
      expect(
        normalizeBusinessNameForAds(
          'Medha Hari,Classical Bharathanatyam Dancer,Choreographer,Home,Chennai,Tamil Nadu,India'
        )
      ).toBe('Medha Hari');
    });

    it('preserves hyphen and apostrophe in names', () => {
      expect(normalizeBusinessNameForAds("O'Brien-Smith")).toBe("O'Brien-Smith");
    });

    it('returns empty string when only special characters remain', () => {
      expect(normalizeBusinessNameForAds('!!!,###')).toBe('');
    });
  });

  it('normalizes comma-stuffed business name in ad copy and keywords', () => {
    const result = validateBusinessContextAdsReadinessSync(
      buildMinimalAdsReadyBusinessContext({
        businessName:
          'Medha Hari,Classical Bharathanatyam Dancer,Choreographer,Home,Chennai,Tamil Nadu,India',
        serviceAreas: ['Chennai'],
        services: ['Dance classes'],
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.normalized.businessName).toBe('Medha Hari');
    expect(result.normalized.adCopySeeds.headlines[0]).toBe('Medha Hari');
    expect(result.normalized.adCopySeeds.descriptions[0]).toContain('Contact Medha Hari today');
    expect(result.normalized.keywordSeeds[1]).toBe('Medha Hari Chennai');
  });

  it('fails when business name has no readable characters after normalization', () => {
    const result = validateBusinessContextAdsReadinessSync(
      buildMinimalAdsReadyBusinessContext({ businessName: '!!!' })
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe(ADS_READINESS_CODES.MISSING_BUSINESS_NAME);
  });

  it('attaches non-blocking scrape warning when latest ScrapeRun has headless disabled', async () => {
    const mongoose = require('mongoose');
    require('../models');
    const ScrapeRun = mongoose.model('ScrapeRun');
    const businessId = new mongoose.Types.ObjectId();
    const userId = new mongoose.Types.ObjectId();

    await ScrapeRun.create({
      businessId,
      userId,
      websiteUrl: 'https://acme.example',
      status: 'SUCCEEDED',
      resultSuggested: {
        headlessStatus: 'disabled_ssrf',
        warnings: ['headless_disabled_ssrf'],
      },
    });

    const result = await validateBusinessContextAdsReadiness(
      buildMinimalAdsReadyBusinessContext({ businessId })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: ADS_READINESS_CODES.HEADLESS_DISABLED_SSRF,
          field: 'scrape',
        }),
      ])
    );

    await ScrapeRun.deleteMany({ businessId });
  });
});
