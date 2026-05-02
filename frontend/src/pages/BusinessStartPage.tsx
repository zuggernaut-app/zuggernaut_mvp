import { type FormEvent, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { createBusinessDraft, scrapeBusiness } from '../api/onboarding'
import { ApiError } from '../api/client'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import { useOnboardingState } from '../hooks/useOnboardingState'
import { MAX_URL_LENGTH, validateHttpUrl } from '../utils/validation'

export function BusinessStartPage(): ReactElement {
  const navigate = useNavigate()
  const { snapshot, setBusinessId, setScrapePreview } = useOnboardingState()
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!snapshot.userId) navigate('/register', { replace: true })
  }, [snapshot.userId, navigate])

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!snapshot.userId) return
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
      const scraped = await scrapeBusiness(businessId, urlCheck.value)
      setScrapePreview({
        websiteUrl: scraped.websiteUrl,
        suggested: scraped.suggested,
      })
      navigate('/onboarding/suggestions', { replace: true })
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not scrape this URL.')
    } finally {
      setBusy(false)
    }
  }

  if (!snapshot.userId) {
    return (
      <PageLayout title="Business">
        <InlineLoading />
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="Your website"
      lead="Create a draft business and scrape your public site for onboarding suggestions."
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
            {busy ? <InlineLoading label="Creating & scraping…" /> : 'Scrape suggestions'}
          </button>
        </div>
      </form>
    </PageLayout>
  )
}
