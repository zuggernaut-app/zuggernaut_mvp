import { useCallback, useEffect, useState } from 'react'
import {
  approveProvisioningRequest,
  cancelProvisioningRequest,
  createProvisioningRequest,
  fetchProvisioningOverview,
  type ProvisioningOverviewResponse,
  type ProvisioningProvider,
  type ProvisioningRequestDto,
} from '../api/integrations'
import { ApiError } from '../api/client'

export interface ProviderMutationState {
  busy: boolean
  error: string | null
}

export interface UseProvisioningOverviewResult {
  overview: ProvisioningOverviewResponse | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
  createRequest: (provider: ProvisioningProvider, setupRunId?: string) => Promise<ProvisioningRequestDto | null>
  approveRequest: (requestId: string) => Promise<ProvisioningRequestDto | null>
  cancelRequest: (requestId: string) => Promise<ProvisioningRequestDto | null>
  mutationByProvider: Partial<Record<ProvisioningProvider, ProviderMutationState>>
}

const EMPTY_MUTATION: ProviderMutationState = { busy: false, error: null }

export function useProvisioningOverview(
  businessId: string | null | undefined,
): UseProvisioningOverviewResult {
  const [overview, setOverview] = useState<ProvisioningOverviewResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mutationByProvider, setMutationByProvider] = useState<
    Partial<Record<ProvisioningProvider, ProviderMutationState>>
  >({})

  const setProviderMutation = useCallback(
    (provider: ProvisioningProvider, patch: Partial<ProviderMutationState>) => {
      setMutationByProvider((prev) => ({
        ...prev,
        [provider]: { ...(prev[provider] ?? EMPTY_MUTATION), ...patch },
      }))
    },
    [],
  )

  const refetch = useCallback(async () => {
    if (!businessId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetchProvisioningOverview(businessId)
      setOverview(res)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load provisioning status.')
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    void refetch()
  }, [refetch])

  const createRequest = useCallback(
    async (provider: ProvisioningProvider, setupRunId?: string) => {
      if (!businessId) return null
      setProviderMutation(provider, { busy: true, error: null })
      try {
        const res = await createProvisioningRequest(provider, { businessId, setupRunId })
        await refetch()
        return res.request
      } catch (err) {
        const msg =
          err instanceof ApiError ? err.message : 'Could not create provisioning request.'
        setProviderMutation(provider, { busy: false, error: msg })
        return null
      } finally {
        setProviderMutation(provider, { busy: false })
      }
    },
    [businessId, refetch, setProviderMutation],
  )

  const approveRequest = useCallback(
    async (requestId: string) => {
      if (!businessId || !overview) return null
      const providerEntry = Object.values(overview.providers).find(
        (p) => p.activeRequest?.id === requestId || p.latestRequest?.id === requestId,
      )
      const provider = providerEntry?.provider
      if (provider) setProviderMutation(provider, { busy: true, error: null })
      try {
        const res = await approveProvisioningRequest(requestId, businessId)
        await refetch()
        return res.request
      } catch (err) {
        const msg =
          err instanceof ApiError ? err.message : 'Could not approve provisioning request.'
        if (provider) setProviderMutation(provider, { busy: false, error: msg })
        return null
      } finally {
        if (provider) setProviderMutation(provider, { busy: false })
      }
    },
    [businessId, overview, refetch, setProviderMutation],
  )

  const cancelRequest = useCallback(
    async (requestId: string) => {
      if (!businessId || !overview) return null
      const providerEntry = Object.values(overview.providers).find(
        (p) => p.activeRequest?.id === requestId || p.latestRequest?.id === requestId,
      )
      const provider = providerEntry?.provider
      if (provider) setProviderMutation(provider, { busy: true, error: null })
      try {
        const res = await cancelProvisioningRequest(requestId, businessId)
        await refetch()
        return res.request
      } catch (err) {
        const msg =
          err instanceof ApiError ? err.message : 'Could not cancel provisioning request.'
        if (provider) setProviderMutation(provider, { busy: false, error: msg })
        return null
      } finally {
        if (provider) setProviderMutation(provider, { busy: false })
      }
    },
    [businessId, overview, refetch, setProviderMutation],
  )

  return {
    overview,
    loading,
    error,
    refetch,
    createRequest,
    approveRequest,
    cancelRequest,
    mutationByProvider,
  }
}
