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

function formatContactMethods(contact: unknown): string[] {
  if (!contact || typeof contact !== 'object') return []
  const lines: string[] = []
  const c = contact as Record<string, unknown>
  if (Array.isArray(c.emails)) {
    for (const email of c.emails) lines.push(`Email: ${String(email)}`)
  }
  if (Array.isArray(c.phones)) {
    for (const phone of c.phones) lines.push(`Phone: ${String(phone)}`)
  }
  if (c.socials && typeof c.socials === 'object') {
    for (const [network, urls] of Object.entries(c.socials as Record<string, unknown>)) {
      if (Array.isArray(urls) && urls[0]) lines.push(`${network}: ${String(urls[0])}`)
    }
  }
  return lines
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

  const { websiteUrl, suggested, scrapeStatus, scrapeQuality, manualFallback } = scrapePreview
  const weakScrape =
    manualFallback === true ||
    scrapeQuality === 'none' ||
    scrapeQuality === 'weak' ||
    scrapeStatus === 'PARTIAL' ||
    scrapeStatus === 'BLOCKED'

  return (
    <PageLayout
      title="Suggested business details"
      lead="Review what we found on your public website. You can edit everything on the next step."
    >
      {weakScrape ? (
        <section className="alert alert-info" style={{ marginBottom: '1.25rem' }}>
          Limited data was extracted from this site
          {scrapeStatus ? ` (status: ${scrapeStatus})` : ''}. Suggestions below are a starting
          point — please review and complete any missing fields.
        </section>
      ) : null}

      <section className="alert alert-info" style={{ marginBottom: '1.25rem' }}>
        <strong>URL:</strong> <span style={{ wordBreak: 'break-all' }}>{websiteUrl}</span>
      </section>

      <h2>Name</h2>
      <p>{suggested.businessName != null ? String(suggested.businessName) : '—'}</p>

      <h2>Industry</h2>
      <p>{suggested.industry != null ? String(suggested.industry) : '—'}</p>

      <h2>Services</h2>
      <ul className="suggestionList">
        {formatList(suggested.services).length ? (
          formatList(suggested.services).map((s) => <li key={s}>{s}</li>)
        ) : (
          <li>—</li>
        )}
      </ul>

      <h2>Service areas</h2>
      <ul className="suggestionList">
        {formatList(suggested.serviceAreas).length ? (
          formatList(suggested.serviceAreas).map((s) => <li key={s}>{s}</li>)
        ) : (
          <li>—</li>
        )}
      </ul>

      <h2>Contact</h2>
      <ul className="suggestionList">
        {formatContactMethods(suggested.contactMethods).length ? (
          formatContactMethods(suggested.contactMethods).map((line) => <li key={line}>{line}</li>)
        ) : (
          <li>—</li>
        )}
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
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => navigate('/onboarding/business')}
        >
          Try another URL
        </button>
      </div>
    </PageLayout>
  )
}
