import { STORAGE_KEYS } from '../utils/storage'

/** Stable fake Mongo-style ids for tests */
export const TEST_IDS = {
  user: '507f1f77bcf86cd799439011',
  business: '507f1f77bcf86cd799439012',
  setupRun: '507f1f77bcf86cd799439013',
} as const

export function seedSession(opts: {
  userId?: string
  businessId?: string
  setupRunId?: string
  scrapePreview?: { websiteUrl: string; suggested: Record<string, unknown> }
}): void {
  localStorage.clear()
  if (opts.userId) localStorage.setItem(STORAGE_KEYS.USER_ID, opts.userId)
  if (opts.businessId) localStorage.setItem(STORAGE_KEYS.BUSINESS_ID, opts.businessId)
  if (opts.setupRunId) localStorage.setItem(STORAGE_KEYS.SETUP_RUN_ID, opts.setupRunId)
  if (opts.scrapePreview) {
    localStorage.setItem(STORAGE_KEYS.SCRAPE_PREVIEW, JSON.stringify(opts.scrapePreview))
  }
}
