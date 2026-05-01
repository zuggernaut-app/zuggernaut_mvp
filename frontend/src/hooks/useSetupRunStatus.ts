import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { getSetupRun } from '../api/setupRuns'
import type { SetupRunDetailResponse } from '../types/api'

const POLL_MS = 2500
const STUCK_AFTER_MS = 5 * 60 * 1000

export interface UseSetupRunStatusResult {
  data: SetupRunDetailResponse | null
  loading: boolean
  error: string | null
  lastUpdatedAt: number | null
  refetch: () => void
  appearsStuck: boolean
  pollingPaused: boolean
}

export function useSetupRunStatus(setupRunId: string | null): UseSetupRunStatusResult {
  const [data, setData] = useState<SetupRunDetailResponse | null>(null)
  const [loading, setLoading] = useState(Boolean(setupRunId))
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const [appearsStuck, setAppearsStuck] = useState(false)
  const [pollingPaused, setPollingPaused] = useState(false)
  const runningSinceRef = useRef<number | null>(null)
  const cancelledRef = useRef(false)

  const bumpStuck = useCallback((status: string) => {
    if (status === 'RUNNING') {
      if (runningSinceRef.current === null) runningSinceRef.current = Date.now()
      else if (Date.now() - runningSinceRef.current > STUCK_AFTER_MS) setAppearsStuck(true)
      setPollingPaused(false)
    } else {
      runningSinceRef.current = null
      setAppearsStuck(false)
      setPollingPaused(true)
    }
  }, [])

  const fetchOnce = useCallback(async (): Promise<SetupRunDetailResponse | undefined> => {
    if (!setupRunId) return undefined
    try {
      const res = await getSetupRun(setupRunId)
      if (cancelledRef.current) return undefined
      setData(res)
      setError(null)
      setLastUpdatedAt(Date.now())
      bumpStuck(res.setupRun.status)
      return res
    } catch (e) {
      if (cancelledRef.current) return undefined
      const msg = e instanceof ApiError ? e.message : 'Failed to load setup run'
      setError(msg)
      return undefined
    }
  }, [setupRunId, bumpStuck])

  useEffect(() => {
    cancelledRef.current = false
    let timerId: number | undefined

    if (!setupRunId) {
      setData(null)
      setLoading(false)
      setError(null)
      setLastUpdatedAt(null)
      setAppearsStuck(false)
      setPollingPaused(false)
      runningSinceRef.current = null
      return
    }

    setLoading(true)
    setError(null)
    runningSinceRef.current = null
    setAppearsStuck(false)
    setPollingPaused(false)

    void fetchOnce().then((res) => {
      if (cancelledRef.current) return
      setLoading(false)
      if (!res || res.setupRun.status !== 'RUNNING') return
      timerId = window.setInterval(() => {
        void fetchOnce().then((latest) => {
          if (!latest || latest.setupRun.status === 'RUNNING' || cancelledRef.current) return
          if (timerId !== undefined) {
            window.clearInterval(timerId)
            timerId = undefined
          }
        })
      }, POLL_MS)
    })

    return () => {
      cancelledRef.current = true
      if (timerId !== undefined) window.clearInterval(timerId)
    }
  }, [setupRunId, fetchOnce])

  return {
    data,
    loading,
    error,
    lastUpdatedAt,
    refetch: () => {
      void fetchOnce()
    },
    appearsStuck,
    pollingPaused,
  }
}
