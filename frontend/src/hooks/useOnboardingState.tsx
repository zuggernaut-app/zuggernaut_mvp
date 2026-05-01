import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactElement,
  type ReactNode,
} from 'react'
import type { ScrapePreviewState } from '../types/api'
import type { OnboardingSnapshot } from '../types/onboarding'
import {
  clearScrapePreview as clearStoredScrapePreview,
  clearStoredSetupRunId,
  getScrapePreview,
  getStoredBusinessId,
  getStoredSetupRunId,
  getStoredUserId,
  setScrapePreview as persistScrapePreview,
  setStoredBusinessId,
  setStoredSetupRunId,
  setStoredUserId,
} from '../utils/storage'

type Subscriber = () => void

const listeners = new Set<Subscriber>()

function emit(): void {
  listeners.forEach((fn) => fn())
}

function subscribeOnboarding(listener: Subscriber): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Compare scrape preview payloads (getScrapePreview() may return freshly parsed objects). */
function scrapePreviewEqual(a: ScrapePreviewState | null, b: ScrapePreviewState | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return (
    a.websiteUrl === b.websiteUrl && JSON.stringify(a.suggested) === JSON.stringify(b.suggested)
  )
}

let cachedSnapshot: OnboardingSnapshot | null = null

function snapshotOnboarding(): OnboardingSnapshot {
  const next: OnboardingSnapshot = {
    userId: getStoredUserId(),
    businessId: getStoredBusinessId(),
    scrapePreview: getScrapePreview(),
    setupRunId: getStoredSetupRunId(),
  }
  const prev = cachedSnapshot
  if (
    prev &&
    prev.userId === next.userId &&
    prev.businessId === next.businessId &&
    prev.setupRunId === next.setupRunId &&
    scrapePreviewEqual(prev.scrapePreview, next.scrapePreview)
  ) {
    return prev
  }
  cachedSnapshot = next
  return next
}

interface OnboardingContextValue {
  snapshot: OnboardingSnapshot
  setUserId: (id: string) => void
  setBusinessId: (id: string) => void
  setScrapePreview: (preview: ScrapePreviewState) => void
  clearScrapePreviewState: () => void
  setSetupRunId: (id: string) => void
  clearSetupRunId: () => void
}

const OnboardingContext = createContext<OnboardingContextValue | null>(null)

export function OnboardingProvider({ children }: { children: ReactNode }): ReactElement {
  const snapshot = useSyncExternalStore(
    subscribeOnboarding,
    snapshotOnboarding,
    snapshotOnboarding
  )

  const value = useMemo<OnboardingContextValue>(
    () => ({
      snapshot,
      setUserId: (id: string) => {
        setStoredUserId(id)
        emit()
      },
      setBusinessId: (id: string) => {
        setStoredBusinessId(id)
        emit()
      },
      setScrapePreview: (preview: ScrapePreviewState) => {
        persistScrapePreview(preview)
        emit()
      },
      clearScrapePreviewState: () => {
        clearStoredScrapePreview()
        emit()
      },
      setSetupRunId: (id: string) => {
        setStoredSetupRunId(id)
        emit()
      },
      clearSetupRunId: () => {
        clearStoredSetupRunId()
        emit()
      },
    }),
    [snapshot]
  )

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>
}

export function useOnboardingState(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext)
  if (!ctx) {
    throw new Error('useOnboardingState must be used within OnboardingProvider')
  }
  return ctx
}
