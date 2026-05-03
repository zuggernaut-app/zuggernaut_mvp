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
import { MAX_URL_LENGTH, validateHttpUrl } from '../utils/validation'

function userMessageForScrapeError(err: ApiError): string {
  switch (err.code) {
    case 'scrape_timeout':
      return err.message
    case 'scrape_failed':
      return err.message || 'Scrape job failed. Try again or use a different URL.'
    case 'scrape_incomplete':
      return err.message
    case 'temporal_unavailable':
      return 'Could not start the scrape job. Is Temporal running and reachable? Check backend logs.'
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

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    const urlCheck = validateHttpUrl(websiteUrl)
    if (!urlCheck.ok) {
      setError(urlCheck.message)
      return
    }
    setBusy(true)
    try {
      let businessId = snapshot.businessId
      if (!businessId) {
        const draft = await createBusinessDraft()
        businessId = draft.businessId
        setBusinessId(businessId)
      }
      const started = await scrapeBusiness(businessId, urlCheck.value)
      const preview = await waitForScrapeCompletion(businessId, started.scrapeRunId)
      setScrapePreview(preview)
      navigate('/onboarding/suggestions', { replace: true })
    } catch (err) {
      if (err instanceof ApiError) setError(userMessageForScrapeError(err))
      else setError('Could not scrape this URL.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageLayout
      title="Your website"
      lead="Create a draft business and scrape your public site for onboarding suggestions. Scraping runs in the background (Temporal); keep the API and worker running."
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
        </div>
      </form>
    </PageLayout>
  )
}
