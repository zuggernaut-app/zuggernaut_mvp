'use strict';

const {
  resolveSetupUserErrorMessage,
  sanitizeSetupErrorSummary,
  isLikelyRawProviderError,
} = require('../lib/setupUserErrorMessages');

describe('setupUserErrorMessages', () => {
  it('maps known error codes to safe user strings', () => {
    expect(
      resolveSetupUserErrorMessage({
        errorCode: 'GTM_ACCOUNT_NOT_FOUND',
        fallbackMessage: 'No GTM account available. Create a GTM account at https://tagmanager.google.com',
      })
    ).toMatch(/tagmanager\.google\.com/i);
  });

  it('replaces likely raw provider errors when code is unknown', () => {
    expect(
      resolveSetupUserErrorMessage({
        errorCode: 'UNKNOWN_CODE',
        fallbackMessage: 'Google Ads API campaigns:mutate failed (403) PERMISSION_DENIED customers/123',
      })
    ).toMatch(/could not be completed/i);
  });

  it('keeps curated fallback messages without provider leakage', () => {
    expect(
      resolveSetupUserErrorMessage({
        fallbackMessage: 'Approve google_ads provisioning to continue setup.',
      })
    ).toBe('Approve google_ads provisioning to continue setup.');
  });

  it('detects raw provider error patterns', () => {
    expect(isLikelyRawProviderError('Google Ads API mutate failed')).toBe(true);
    expect(isLikelyRawProviderError('Install GTM snippet')).toBe(false);
  });

  it('sanitizeSetupErrorSummary uses support error code', () => {
    expect(
      sanitizeSetupErrorSummary('Google Ads API mutate failed', 'GOOGLE_ADS_MUTATE_FAILED')
    ).toMatch(/could not apply the requested changes/i);
  });
});
