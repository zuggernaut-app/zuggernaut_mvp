import type { ScrapePreviewState } from '../types/api'

const PREFIX = 'zuggernaut:'

export const STORAGE_KEYS = {
  USER_ID: `${PREFIX}userId`,
  BUSINESS_ID: `${PREFIX}businessId`,
  SCRAPE_PREVIEW: `${PREFIX}scrapePreview`,
  SETUP_RUN_ID: `${PREFIX}setupRunId`,
} as const

function readJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function getStoredUserId(): string | null {
  return localStorage.getItem(STORAGE_KEYS.USER_ID)?.trim() || null
}

export function setStoredUserId(id: string): void {
  localStorage.setItem(STORAGE_KEYS.USER_ID, id)
}

export function clearStoredUserId(): void {
  localStorage.removeItem(STORAGE_KEYS.USER_ID)
}

export function getStoredBusinessId(): string | null {
  return localStorage.getItem(STORAGE_KEYS.BUSINESS_ID)?.trim() || null
}

export function setStoredBusinessId(id: string): void {
  localStorage.setItem(STORAGE_KEYS.BUSINESS_ID, id)
}

export function getStoredSetupRunId(): string | null {
  return localStorage.getItem(STORAGE_KEYS.SETUP_RUN_ID)?.trim() || null
}

export function setStoredSetupRunId(id: string): void {
  localStorage.setItem(STORAGE_KEYS.SETUP_RUN_ID, id)
}

export function clearStoredSetupRunId(): void {
  localStorage.removeItem(STORAGE_KEYS.SETUP_RUN_ID)
}

export function getScrapePreview(): ScrapePreviewState | null {
  return readJson<ScrapePreviewState>(localStorage.getItem(STORAGE_KEYS.SCRAPE_PREVIEW))
}

export function setScrapePreview(preview: ScrapePreviewState): void {
  localStorage.setItem(STORAGE_KEYS.SCRAPE_PREVIEW, JSON.stringify(preview))
}

export function clearScrapePreview(): void {
  localStorage.removeItem(STORAGE_KEYS.SCRAPE_PREVIEW)
}

/** Clear onboarding session data (keep userId for signed-in dev flow if desired). */
export function clearOnboardingDrafts(): void {
  localStorage.removeItem(STORAGE_KEYS.BUSINESS_ID)
  clearScrapePreview()
  clearStoredSetupRunId()
}

export function resetLocalSession(): void {
  for (const key of Object.values(STORAGE_KEYS)) {
    localStorage.removeItem(key)
  }
}
