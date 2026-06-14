import { type FormEvent, useState } from 'react'
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  createBusinessDraft,
  scrapeBusiness,
  waitForScrapeCompletion,
} from '../api/onboarding'
import { ApiError } from '../api/client'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import { useOnboardingState } from '../hooks/useOnboardingState'
import { buildManualFallbackPreview } from '../lib/onboardingFallback'
import { MAX_URL_LENGTH, validateHttpUrl } from '../utils/validation'

function userMessageForScrapeError(err: ApiError): string {
  switch (err.code) {
    case 'scrape_timeout':
      return err.message
    case 'scrape_failed':
      return err.message || 'Scrape job failed. Try again or enter details manually.'
    case 'scrape_incomplete':
      return err.message
    case 'temporal_unavailable':
      return 'Could not start the scrape job. Is Temporal running and reachable? You can still enter details manually.'
    case 'network_error':
      return err.message
    default:
      return err.message || 'Could not scrape this URL.'
  }
}

export function BusinessStartPage(): ReactElement {
  const navigate = useNavigate()
  const { snapshot, setBusinessId, setScrapePreview } = useOnboardingState()
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastFailedUrl, setLastFailedUrl] = useState<string | null>(null)

  async function ensureBusinessDraft(): Promise<string> {
    let businessId = snapshot.businessId
    if (!businessId) {
      const draft = await createBusinessDraft()
      businessId = draft.businessId
      setBusinessId(businessId)
    }
    return businessId
  }

  async function continueManually(url: string): Promise<void> {
    setError(null)
    setBusy(true)
    try {
      await ensureBusinessDraft()
      setScrapePreview(buildManualFallbackPreview(url))
      navigate('/onboarding/review', { replace: true })
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not start manual onboarding.')
    } finally {
      setBusy(false)
    }
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setLastFailedUrl(null)
    const urlCheck = validateHttpUrl(websiteUrl)
    if (!urlCheck.ok) {
      setError(urlCheck.message)
      return
    }
    setBusy(true)
    try {
      const businessId = await ensureBusinessDraft()
      const started = await scrapeBusiness(businessId, urlCheck.value)
      const preview = await waitForScrapeCompletion(businessId, started.scrapeRunId)
      setScrapePreview(preview)
      navigate('/onboarding/suggestions', { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        setError(userMessageForScrapeError(err))
        setLastFailedUrl(urlCheck.value)
      } else {
        setError('Could not scrape this URL.')
        setLastFailedUrl(urlCheck.value)
      }
    } finally {
      setBusy(false)
    }
  }

  async function startManualEntry(): Promise<void> {
    const urlCheck = validateHttpUrl(websiteUrl)
    if (!urlCheck.ok) {
      setError(urlCheck.message)
      return
    }
    await continueManually(urlCheck.value)
  }

  return (
    <PageLayout
      title="Your website"
      lead="Enter your public website URL. We will suggest business details from your site, or you can fill them in manually."
    >
      <form className="form" onSubmit={(e) => void onSubmit(e)}>
        <ErrorAlert message={error} />
        <div className="field">
          <label htmlFor="websiteUrl">Website URL</label>
          <input
            id="websiteUrl"
            name="websiteUrl"
            type="url"
            placeholder="https://example.com"
            required
            maxLength={MAX_URL_LENGTH}
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
          />
        </div>
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? (
              <InlineLoading label="Scraping site (may take a few minutes)…" />
            ) : (
              'Scrape suggestions'
            )}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void startManualEntry()}
          >
            Enter details manually
          </button>
        </div>
        {lastFailedUrl ? (
          <div className="actions" style={{ marginTop: '0.75rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => void continueManually(lastFailedUrl)}
            >
              Continue manually with this URL
            </button>
          </div>
        ) : null}
      </form>
    </PageLayout>
  )
}
