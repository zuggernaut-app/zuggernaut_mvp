import type { ScrapePreviewState, ScrapeSuggested } from '../types/api'

/** Hostname-based business name when scrape is skipped or weak. */
export function deriveBusinessNameFromUrl(websiteUrl: string): string {
  try {
    const host = new URL(websiteUrl).hostname.replace(/^www\./, '')
    const part = host.split('.')[0] || 'business'
    return part.charAt(0).toUpperCase() + part.slice(1)
  } catch {
    return 'Your business'
  }
}

/** First-class manual path — empty suggestions, user fills review form. */
export function buildManualFallbackPreview(websiteUrl: string): ScrapePreviewState {
  const suggested: ScrapeSuggested = {
    businessName: deriveBusinessNameFromUrl(websiteUrl),
    industry: undefined,
    services: [],
    serviceAreas: [],
    contactMethods: null,
    goals: null,
    differentiators:
      'Enter what makes your business different — scrape was skipped or returned limited data.',
    orderValueHint: undefined,
    scrapeQuality: 'none',
    manualFallback: true,
  }

  return {
    websiteUrl,
    suggested,
    scrapeStatus: 'MANUAL',
    scrapeQuality: 'none',
    manualFallback: true,
  }
}
