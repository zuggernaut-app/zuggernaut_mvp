import { useEffect } from 'react'
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageLayout } from '../components/layout/PageLayout'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { useOnboardingState } from '../hooks/useOnboardingState'

function formatList(val: unknown): string[] {
  if (Array.isArray(val)) return val.map((v) => String(v)).filter(Boolean)
  return []
}

export function WebsiteUrlPage(): ReactElement {
  const navigate = useNavigate()
  const { snapshot } = useOnboardingState()
  const { scrapePreview, businessId } = snapshot

  useEffect(() => {
    if (!businessId || !scrapePreview) navigate('/onboarding/business', { replace: true })
  }, [businessId, scrapePreview, navigate])

  if (!businessId || !scrapePreview) {
    return (
      <PageLayout title="Suggestions">
        <InlineLoading />
      </PageLayout>
    )
  }

  const { websiteUrl, suggested } = scrapePreview

  return (
    <PageLayout
      title="Suggested business details"
      lead="Suggestions from your public website (async scrape + extraction). Confirm on the next step."
    >
      <section className="alert alert-info" style={{ marginBottom: '1.25rem' }}>
        <strong>URL:</strong> <span style={{ wordBreak: 'break-all' }}>{websiteUrl}</span>
      </section>

      <h2>Name</h2>
      <p>{suggested.businessName != null ? String(suggested.businessName) : '—'}</p>

      <h2>Industry</h2>
      <p>{suggested.industry != null ? String(suggested.industry) : '—'}</p>

      <h2>Services</h2>
      <ul className="suggestionList">
        {formatList(suggested.services).map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>

      <h2>Service areas</h2>
      <ul className="suggestionList">
        {formatList(suggested.serviceAreas).map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ul>

      <h2>Differentiators</h2>
      <p>{suggested.differentiators != null ? String(suggested.differentiators) : '—'}</p>

      <h2>Order value hint</h2>
      <p>{suggested.orderValueHint != null ? String(suggested.orderValueHint) : '—'}</p>

      <div className="actions" style={{ marginTop: '2rem' }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => navigate('/onboarding/review')}
        >
          Review & edit details
        </button>
      </div>
    </PageLayout>
  )
}
