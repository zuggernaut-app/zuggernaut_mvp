import type {
  IntegrationConnectionStatusDto,
  IntegrationProvider,
  ProvisioningProvider,
} from '../api/integrations'

export const GTM_PROVISIONING_REQUIRED = 'GTM_PROVISIONING_REQUIRED'
export const ADS_PROVISIONING_REQUIRED = 'ADS_PROVISIONING_REQUIRED'

export const PROVISIONING_SETUP_STATUSES = [
  GTM_PROVISIONING_REQUIRED,
  ADS_PROVISIONING_REQUIRED,
] as const

export type ProvisioningSetupStatus = (typeof PROVISIONING_SETUP_STATUSES)[number]

export function isProvisioningRequiredStatus(status: string): status is ProvisioningSetupStatus {
  return status === GTM_PROVISIONING_REQUIRED || status === ADS_PROVISIONING_REQUIRED
}

export function providerFromProvisioningStatus(status: string): ProvisioningProvider | null {
  if (status === GTM_PROVISIONING_REQUIRED) return 'gtm'
  if (status === ADS_PROVISIONING_REQUIRED) return 'google_ads'
  return null
}

export interface ProvisioningCopy {
  title: string
  missing: string
  willCreate: string
  whyApproval: string
  resources: string[]
  gbpNote: string
}

const PROVISIONING_COPY: Record<ProvisioningProvider, ProvisioningCopy> = {
  gtm: {
    title: 'Google Tag Manager provisioning approval',
    missing:
      'Your Google account is connected and a GTM account exists, but no usable web container or workspace was found.',
    willCreate:
      'After you approve, Zuggernaut will create a web container and default workspace in your GTM account on the next setup run.',
    whyApproval:
      'Creating Google resources requires your explicit consent. We store this approval as an audit record before any GTM container is created.',
    resources: ['Web container', 'Default workspace'],
    gbpNote:
      'Google Business Profile is not modified by this step. GBP remains read-only audit only.',
  },
  google_ads: {
    title: 'Google Ads customer provisioning approval',
    missing:
      'Your Google account is connected, but no accessible Google Ads customer account was found for setup.',
    willCreate:
      'After you approve, Zuggernaut will create a Google Ads customer account via the configured manager (MCC) account on the next setup run, where permitted.',
    whyApproval:
      'Creating a billable Google Ads customer requires your explicit consent. We store this approval before provisioning any customer account.',
    resources: ['Google Ads customer account (via MCC where available)'],
    gbpNote:
      'Google Business Profile is not modified by this step. GBP remains read-only audit only.',
  },
}

export function provisioningCopy(provider: ProvisioningProvider): ProvisioningCopy {
  return PROVISIONING_COPY[provider]
}

export function provisioningProviderLabel(provider: ProvisioningProvider): string {
  if (provider === 'gtm') return 'Google Tag Manager'
  return 'Google Ads'
}

/** OAuth-connected providers eligible to start setup (provisioning may continue on progress screen). */
export function canAttemptSetup(
  status: IntegrationConnectionStatusDto | undefined,
): boolean {
  if (!status) return false
  if (status.ready) return true
  return status.reason === 'provisioning_required'
}

export function requiredProvidersReadyForSetup(
  connections: Partial<Record<IntegrationProvider, IntegrationConnectionStatusDto>>,
): boolean {
  return canAttemptSetup(connections.google_ads)
}

/** Optional integrations worth connecting before or after setup (non-blocking). */
export function optionalIntegrationNudge(
  connections: Partial<Record<IntegrationProvider, IntegrationConnectionStatusDto>>,
): IntegrationProvider[] {
  const nudge: IntegrationProvider[] = []
  const gtm = connections.gtm
  if (gtm && !gtm.ready && gtm.reason !== 'missing_connection' && gtm.reason !== 'not_connected') {
    nudge.push('gtm')
  }
  const gbp = connections.gbp
  if (gbp && !gbp.ready && gbp.reason === 'missing_connection') {
    nudge.push('gbp')
  }
  return nudge
}

export function integrationStatusLabel(status: IntegrationConnectionStatusDto): string {
  if (status.ready) return 'Connected'
  if (status.reason === 'selection_required') return 'Account selection needed'
  if (status.reason === 'gtm_account_required') return 'GTM account needed'
  if (status.reason === 'provisioning_required') return 'Provisioning approval needed'
  if (status.reason === 'insufficient_scopes') return 'Insufficient scopes'
  if (status.reason === 'token_expired' || status.reason === 'needs_reauth') {
    return 'Needs reconnection'
  }
  if (status.reason === 'missing_connection') return 'Not connected'
  return 'Not ready'
}
