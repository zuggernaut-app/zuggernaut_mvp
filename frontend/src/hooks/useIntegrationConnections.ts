import { useCallback, useEffect, useState } from 'react'
import {
  fetchGoogleConnectUrl,
  fetchIntegrationStatus,
  type IntegrationConnectionStatusDto,
  type IntegrationProvider,
} from '../api/integrations'
import { ApiError } from '../api/client'
import { canAttemptSetup, integrationStatusLabel } from '../lib/provisioningUi'

const PROVIDERS: IntegrationProvider[] = ['gbp', 'gtm', 'google_ads']

const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  gbp: 'Google Business Profile (optional)',
  gtm: 'Google Tag Manager (required)',
  google_ads: 'Google Ads (required)',
}

function statusLabel(status: IntegrationConnectionStatusDto): string {
  return integrationStatusLabel(status)
}

export interface UseIntegrationConnectionsResult {
  connections: Partial<Record<IntegrationProvider, IntegrationConnectionStatusDto>>
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  connectProvider: (provider: IntegrationProvider) => Promise<void>
  providerLabels: typeof PROVIDER_LABELS
  statusLabel: (status: IntegrationConnectionStatusDto) => string
  canAttemptSetup: (status: IntegrationConnectionStatusDto | undefined) => boolean
}

export function useIntegrationConnections(
  businessId: string | null | undefined,
): UseIntegrationConnectionsResult {
  const [connections, setConnections] = useState<
    Partial<Record<IntegrationProvider, IntegrationConnectionStatusDto>>
  >({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetchIntegrationStatus(businessId)
      setConnections(res.connections)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load integration status.')
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    void refetch()
  }, [refetch])

  const connectProvider = useCallback(
    async (provider: IntegrationProvider) => {
      if (!businessId) return
      setError(null)
      try {
        const res = await fetchGoogleConnectUrl(provider, businessId)
        window.location.assign(res.url)
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not start Google connection.')
      }
    },
    [businessId],
  )

  return {
    connections,
    loading,
    error,
    refetch,
    connectProvider,
    providerLabels: PROVIDER_LABELS,
    statusLabel,
    canAttemptSetup,
  }
}

export { PROVIDERS as INTEGRATION_PROVIDERS }
