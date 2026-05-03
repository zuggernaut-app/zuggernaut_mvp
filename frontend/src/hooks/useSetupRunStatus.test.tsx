import { renderHook, waitFor } from '@testing-library/react'
import type { SetupRunDetailResponse } from '../types/api'
import { useSetupRunStatus } from './useSetupRunStatus'
import { getSetupRun } from '../api/setupRuns'
import { ApiError } from '../api/client'

vi.mock('../api/setupRuns', () => ({
  getSetupRun: vi.fn(),
}))

const mockGetSetupRun = vi.mocked(getSetupRun)

function makeRun(status: string): SetupRunDetailResponse {
  return {
    setupRun: {
      id: 'run-1',
      businessId: 'biz-1',
      temporalWorkflowId: 'wf-1',
      status,
      lastErrorSummary: null,
      meta: null,
    },
    steps: [],
  }
}

describe('useSetupRunStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('resets when setupRunId is null', () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useSetupRunStatus(id),
      { initialProps: { id: 'x' as string | null } },
    )
    rerender({ id: null })
    expect(result.current.data).toBe(null)
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBe(null)
    expect(result.current.appearsStuck).toBe(false)
  })

  it('loads run and stops polling when not RUNNING', async () => {
    mockGetSetupRun.mockResolvedValueOnce(makeRun('SUCCEEDED'))

    const { result } = renderHook(() => useSetupRunStatus('run-1'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.data?.setupRun.status).toBe('SUCCEEDED')
    expect(result.current.pollingPaused).toBe(true)
    expect(mockGetSetupRun).toHaveBeenCalledTimes(1)
  })

  it('polls while RUNNING then stops after terminal status', async () => {
    mockGetSetupRun
      .mockResolvedValueOnce(makeRun('RUNNING'))
      .mockResolvedValueOnce(makeRun('SUCCEEDED'))

    const { result } = renderHook(() => useSetupRunStatus('run-1'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.data?.setupRun.status).toBe('RUNNING')

    await waitFor(
      () => {
        expect(result.current.data?.setupRun.status).toBe('SUCCEEDED')
      },
      { timeout: 8000 },
    )
    expect(mockGetSetupRun).toHaveBeenCalledTimes(2)
  })

  it('sets appearsStuck after long RUNNING', async () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)

    let calls = 0
    mockGetSetupRun.mockImplementation(async () => {
      calls++
      if (calls >= 2) {
        now += 6 * 60 * 1000
      }
      return makeRun('RUNNING')
    })

    const { result } = renderHook(() => useSetupRunStatus('run-1'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })

    await waitFor(
      () => {
        expect(result.current.appearsStuck).toBe(true)
      },
      { timeout: 8000 },
    )
  })

  it('surfaces ApiError message', async () => {
    mockGetSetupRun.mockRejectedValueOnce(
      new ApiError(404, 'Setup run not found', 'not_found'),
    )

    const { result } = renderHook(() => useSetupRunStatus('missing'))

    await waitFor(() => {
      expect(result.current.loading).toBe(false)
    })
    expect(result.current.error).toBe('Setup run not found')
  })
})
