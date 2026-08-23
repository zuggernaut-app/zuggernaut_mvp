import { describe, expect, it } from 'vitest'
import {
  resolveSetupUserErrorMessage,
  sanitizeSetupErrorSummary,
} from './setupUserErrorMessages'

describe('setupUserErrorMessages', () => {
  it('maps known error codes to safe user strings', () => {
    expect(
      resolveSetupUserErrorMessage({
        errorCode: 'GOOGLE_ADS_MUTATE_FAILED',
        fallbackMessage: 'Google Ads API mutate failed with customers/123',
      }),
    ).toMatch(/could not apply the requested changes/i)
  })

  it('replaces likely raw provider errors when code is unknown', () => {
    expect(
      resolveSetupUserErrorMessage({
        errorCode: 'UNKNOWN_PROVIDER_CODE',
        fallbackMessage: 'Google Ads API campaigns:mutate failed (403) PERMISSION_DENIED',
      }),
    ).toMatch(/could not be completed/i)
  })

  it('keeps curated fallback messages without provider leakage', () => {
    expect(
      resolveSetupUserErrorMessage({
        fallbackMessage: 'Keyword text contains invalid characters or symbols.',
      }),
    ).toBe('Keyword text contains invalid characters or symbols.')
  })

  it('sanitizeSetupErrorSummary returns null for empty input', () => {
    expect(sanitizeSetupErrorSummary(null, 'GOOGLE_ADS_MUTATE_FAILED')).toBeNull()
  })
})
