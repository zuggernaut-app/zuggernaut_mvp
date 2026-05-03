import { type ReactElement, type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { OnboardingProvider, useOnboardingState } from './useOnboardingState'
import {
  clearStoredSetupRunId,
  getStoredBusinessId,
  getStoredSetupRunId,
  getStoredUserId,
  setStoredUserId,
} from '../utils/storage'

function wrapper({ children }: { children: ReactNode }): ReactElement {
  return <OnboardingProvider>{children}</OnboardingProvider>
}

describe('useOnboardingState', () => {
  beforeEach(() => {
    localStorage.clear()
    setStoredUserId('seed-user')
  })

  it('reflects snapshot from localStorage', () => {
    const { result } = renderHook(() => useOnboardingState(), { wrapper })
    expect(result.current.snapshot.userId).toBe('seed-user')
    expect(result.current.snapshot.businessId).toBe(null)
  })

  it('setUserId updates storage and snapshot', () => {
    const { result } = renderHook(() => useOnboardingState(), { wrapper })
    act(() => {
      result.current.setUserId('u-2')
    })
    expect(getStoredUserId()).toBe('u-2')
    expect(result.current.snapshot.userId).toBe('u-2')
  })

  it('setBusinessId and setSetupRunId persist', () => {
    const { result } = renderHook(() => useOnboardingState(), { wrapper })
    act(() => {
      result.current.setBusinessId('biz-1')
      result.current.setSetupRunId('run-1')
    })
    expect(getStoredBusinessId()).toBe('biz-1')
    expect(getStoredSetupRunId()).toBe('run-1')
  })

  it('clearScrapePreviewState only clears scrape data', () => {
    const { result } = renderHook(() => useOnboardingState(), { wrapper })
    act(() => {
      result.current.setScrapePreview({
        websiteUrl: 'https://a.com',
        suggested: { businessName: 'A' },
      })
    })
    act(() => {
      result.current.clearScrapePreviewState()
    })
    expect(result.current.snapshot.scrapePreview).toBe(null)
    expect(result.current.snapshot.userId).toBe('seed-user')
  })

  it('clearSetupRunId removes run id', () => {
    const { result } = renderHook(() => useOnboardingState(), { wrapper })
    act(() => {
      result.current.setSetupRunId('r')
    })
    act(() => {
      result.current.clearSetupRunId()
    })
    expect(getStoredSetupRunId()).toBe(null)
  })
})

describe('clearStoredSetupRunId (storage side)', () => {
  beforeEach(() => localStorage.clear())

  it('can be cleared directly (used by flows that bypass context)', () => {
    localStorage.setItem('zuggernaut:setupRunId', 'x')
    clearStoredSetupRunId()
    expect(getStoredSetupRunId()).toBe(null)
  })
})
