import {
  STORAGE_KEYS,
  clearStoredUserId,
  clearOnboardingDrafts,
  getScrapePreview,
  getStoredBusinessId,
  getStoredSetupRunId,
  getStoredUserId,
  resetLocalSession,
  setScrapePreview,
  setStoredBusinessId,
  setStoredSetupRunId,
  setStoredUserId,
} from './storage'

describe('storage helpers', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('persists user / business / setup run ids', () => {
    setStoredUserId('  user-1  ')
    setStoredBusinessId('biz')
    setStoredSetupRunId('run')
    expect(getStoredUserId()).toBe('user-1')
    expect(getStoredBusinessId()).toBe('biz')
    expect(getStoredSetupRunId()).toBe('run')
    expect(localStorage.getItem(STORAGE_KEYS.USER_ID)).toBe('  user-1  ')
  })

  it('returns null scrape preview when missing or invalid JSON', () => {
    expect(getScrapePreview()).toBe(null)
    localStorage.setItem(STORAGE_KEYS.SCRAPE_PREVIEW, '{bad')
    expect(getScrapePreview()).toBe(null)
  })

  it('round-trips scrape preview', () => {
    const preview = {
      websiteUrl: 'https://example.com',
      suggested: { businessName: 'Acme' },
    }
    setScrapePreview(preview)
    expect(getScrapePreview()).toEqual(preview)
  })

  it('clearOnboardingDrafts keeps user id', () => {
    setStoredUserId('u')
    setStoredBusinessId('b')
    setStoredSetupRunId('r')
    setScrapePreview({ websiteUrl: 'https://x.com', suggested: {} })
    clearOnboardingDrafts()
    expect(getStoredUserId()).toBe('u')
    expect(getStoredBusinessId()).toBe(null)
    expect(getStoredSetupRunId()).toBe(null)
    expect(getScrapePreview()).toBe(null)
  })

  it('clearStoredUserId removes persisted user row', () => {
    setStoredUserId('u')
    clearStoredUserId()
    expect(getStoredUserId()).toBe(null)
  })

  it('resetLocalSession clears all keys', () => {
    setStoredUserId('u')
    setStoredBusinessId('b')
    resetLocalSession()
    expect(Object.keys(localStorage).filter((k) => k.startsWith('zuggernaut:'))).toHaveLength(
      0,
    )
  })
})
