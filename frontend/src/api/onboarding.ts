import type { ScrapePreviewState, ScrapeStartResponse, ScrapeRunPollResponse } from '../types/api'
import { ApiError, apiRequest } from './client'

export function createBusinessDraft(): Promise<{ businessId: string }> {
  return apiRequest('/onboarding/business', {
    method: 'POST',
    body: {},
  })
}

/** Starts async scrape (Temporal). Poll with `pollScrapeRun` / `waitForScrapeCompletion`. */
export function scrapeBusiness(
  businessId: string,
  websiteUrl: string
): Promise<ScrapeStartResponse> {
  return apiRequest<ScrapeStartResponse>(`/onboarding/business/${businessId}/scrape`, {
    method: 'POST',
    body: { websiteUrl },
  })
}

export function pollScrapeRun(
  businessId: string,
  scrapeRunId: string
): Promise<ScrapeRunPollResponse> {
  return apiRequest<ScrapeRunPollResponse>(
    `/onboarding/business/${businessId}/scrape-runs/${scrapeRunId}`
  )
}

const TERMINAL_SCRAPE_STATUSES = new Set(['SUCCEEDED', 'PARTIAL', 'BLOCKED', 'FAILED'])

/** Default ~5 minutes at 1s intervals (headless crawl can be slow). */
export const DEFAULT_SCRAPE_POLL_MAX_ATTEMPTS = 300
export const DEFAULT_SCRAPE_POLL_DELAY_MS = 1000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export interface WaitForScrapeOptions {
  maxAttempts?: number
  delayMs?: number
}

/** Poll until scrape completes or fails (requires Temporal worker for success). */
export async function waitForScrapeCompletion(
  businessId: string,
  scrapeRunId: string,
  options?: WaitForScrapeOptions
): Promise<ScrapePreviewState> {
  const maxAttempts = options?.maxAttempts ?? DEFAULT_SCRAPE_POLL_MAX_ATTEMPTS
  const delayMs = options?.delayMs ?? DEFAULT_SCRAPE_POLL_DELAY_MS
  let lastStatus = ''
  for (let i = 0; i < maxAttempts; i++) {
    const { scrapeRun } = await pollScrapeRun(businessId, scrapeRunId)
    lastStatus = scrapeRun.status
    if (TERMINAL_SCRAPE_STATUSES.has(scrapeRun.status)) {
      if (scrapeRun.status === 'FAILED') {
        throw new ApiError(
          503,
          scrapeRun.lastErrorSummary ?? 'Scrape job failed.',
          'scrape_failed',
          {
            error: 'scrape_failed',
            message: scrapeRun.lastErrorSummary ?? 'Scrape job failed.',
          }
        )
      }
      if (!scrapeRun.suggested) {
        throw new ApiError(
          500,
          'Scrape finished but the server returned no suggestions. You can continue and enter details manually.',
          'scrape_incomplete',
          {
            error: 'scrape_incomplete',
            message: 'Scrape finished without suggestions.',
          }
        )
      }
      return {
        websiteUrl: scrapeRun.websiteUrl,
        suggested: scrapeRun.suggested,
      }
    }
    await sleep(delayMs)
  }
  const approxMinutes = Math.round((maxAttempts * delayMs) / 60_000)
  throw new ApiError(
    504,
    `Scrape still running after about ${approxMinutes} minute(s) (last status: ${lastStatus}). Start the Temporal worker (\`npm run temporal:worker\` in backend) and try again.`,
    'scrape_timeout'
  )
}
