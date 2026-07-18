import { describe, expect, it } from 'vitest'
import {
  canAttemptSetup,
  integrationStatusLabel,
  isProvisioningRequiredStatus,
  providerFromProvisioningStatus,
  provisioningCopy,
  requiredProvidersReadyForSetup,
} from './provisioningUi'
import type { IntegrationConnectionStatusDto } from '../api/integrations'

function conn(
  overrides: Partial<IntegrationConnectionStatusDto> & Pick<IntegrationConnectionStatusDto, 'provider'>,
): IntegrationConnectionStatusDto {
  return {
    ready: false,
    reason: 'missing_connection',
    connectionHealth: null,
    nextAction: null,
    scopesGranted: [],
    scopesMissing: [],
    providerIdentifiers: null,
    ...overrides,
  }
}

describe('provisioningUi', () => {
  it('maps setup status to provisioning provider', () => {
    expect(isProvisioningRequiredStatus('GTM_PROVISIONING_REQUIRED')).toBe(true)
    expect(providerFromProvisioningStatus('GTM_PROVISIONING_REQUIRED')).toBe('gtm')
    expect(providerFromProvisioningStatus('ADS_PROVISIONING_REQUIRED')).toBe('google_ads')
    expect(providerFromProvisioningStatus('RUNNING')).toBeNull()
  })

  it('returns provider-specific copy with GBP note', () => {
    const gtm = provisioningCopy('gtm')
    expect(gtm.resources).toEqual(['Web container', 'Default workspace'])
    expect(gtm.gbpNote).toMatch(/GBP/i)

    const ads = provisioningCopy('google_ads')
    expect(ads.resources[0]).toMatch(/Google Ads customer/)
  })

  it('labels provisioning_required connections', () => {
    expect(
      integrationStatusLabel(conn({ provider: 'gtm', reason: 'provisioning_required' })),
    ).toBe('Provisioning approval needed')
    expect(
      integrationStatusLabel(conn({ provider: 'gtm', reason: 'gtm_account_required' })),
    ).toBe('GTM account needed')
    expect(
      integrationStatusLabel(conn({ provider: 'google_ads', reason: 'ads_customer_not_found' })),
    ).toBe('Google Ads account needed')
  })

  it('labels selection_required connections', () => {
    expect(
      integrationStatusLabel(conn({ provider: 'google_ads', reason: 'selection_required' })),
    ).toBe('Account selection needed')
    expect(canAttemptSetup(conn({ provider: 'google_ads', reason: 'selection_required' }))).toBe(
      false,
    )
  })

  it('allows setup when OAuth-connected but provisioning is required', () => {
    expect(canAttemptSetup(conn({ provider: 'gtm', reason: 'provisioning_required' }))).toBe(true)
    expect(canAttemptSetup(conn({ provider: 'gtm', ready: true, reason: 'ok' }))).toBe(true)
    expect(canAttemptSetup(conn({ provider: 'gtm', reason: 'missing_connection' }))).toBe(false)
    expect(canAttemptSetup(conn({ provider: 'gtm', reason: 'insufficient_scopes' }))).toBe(false)
    expect(canAttemptSetup(conn({ provider: 'gtm', reason: 'needs_reauth' }))).toBe(false)
  })

  it('requires only Google Ads to attempt setup', () => {
    expect(
      requiredProvidersReadyForSetup({
        gtm: conn({ provider: 'gtm', reason: 'provisioning_required' }),
        google_ads: conn({ provider: 'google_ads', ready: true, reason: 'ok' }),
      }),
    ).toBe(true)

    expect(
      requiredProvidersReadyForSetup({
        gtm: conn({ provider: 'gtm', ready: true, reason: 'ok' }),
        google_ads: conn({ provider: 'google_ads', reason: 'missing_connection' }),
      }),
    ).toBe(false)

    expect(
      requiredProvidersReadyForSetup({
        gtm: conn({ provider: 'gtm', reason: 'selection_required' }),
        google_ads: conn({ provider: 'google_ads', ready: true, reason: 'ok' }),
      }),
    ).toBe(true)
  })
})
