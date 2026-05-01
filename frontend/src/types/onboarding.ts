import type { ScrapePreviewState } from './api'

/** Local-only onboarding snapshot (persisted IDs + last scrape preview). */
export interface OnboardingSnapshot {
  userId: string | null
  businessId: string | null
  scrapePreview: ScrapePreviewState | null
  setupRunId: string | null
}
