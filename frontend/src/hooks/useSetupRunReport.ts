import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../api/client'
import { getSetupRunReport } from '../api/setupReports'
import type { SetupRunReport } from '../types/api'

export interface UseSetupRunReportResult {
  report: SetupRunReport | null
  loading: boolean
  error: string | null
  lastUpdatedAt: number | null
  refetch: () => void
}

export function useSetupRunReport(setupRunId: string | null): UseSetupRunReportResult {
  const [report, setReport] = useState<SetupRunReport | null>(null)
  const [loading, setLoading] = useState(Boolean(setupRunId))
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)

  const fetchOnce = useCallback(async () => {
    if (!setupRunId) return
    try {
      const res = await getSetupRunReport(setupRunId)
      setReport(res.report)
      setError(null)
      setLastUpdatedAt(Date.now())
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Failed to load setup report'
      setError(msg)
    }
  }, [setupRunId])

  useEffect(() => {
    if (!setupRunId) {
      setReport(null)
      setLoading(false)
      setError(null)
      setLastUpdatedAt(null)
      return
    }

    setLoading(true)
    setError(null)
    void fetchOnce().finally(() => setLoading(false))
  }, [setupRunId, fetchOnce])

  return {
    report,
    loading,
    error,
    lastUpdatedAt,
    refetch: () => {
      void fetchOnce()
    },
  }
}
