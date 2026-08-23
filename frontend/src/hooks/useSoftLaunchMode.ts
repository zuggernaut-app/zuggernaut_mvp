import { useCallback, useEffect, useState } from 'react'
import { fetchSoftLaunchSettings } from '../api/settings'

export interface UseSoftLaunchModeResult {
  softLaunchMode: boolean
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useSoftLaunchMode(): UseSoftLaunchModeResult {
  const [softLaunchMode, setSoftLaunchMode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchSoftLaunchSettings()
      setSoftLaunchMode(res.softLaunchMode)
      setError(null)
    } catch {
      setSoftLaunchMode(false)
      setError('Could not load soft-launch settings.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refetch()
  }, [refetch])

  return { softLaunchMode, loading, error, refetch }
}
