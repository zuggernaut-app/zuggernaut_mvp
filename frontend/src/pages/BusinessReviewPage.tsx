import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { updateBusinessContext } from '../api/businessContexts'
import type { BusinessContextUpdateBody } from '../types/api'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import { useOnboardingState } from '../hooks/useOnboardingState'

function splitLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function parseOptionalObject(raw: string): unknown | undefined {
  const t = raw.trim()
  if (!t) return undefined
  return JSON.parse(t) as unknown
}

export function BusinessReviewPage(): ReactElement {
  const navigate = useNavigate()
  const { snapshot, clearScrapePreviewState } = useOnboardingState()
  const { userId, businessId, scrapePreview } = snapshot
  /** After successful PUT, scrape preview clears async; suppress redirect-to-business until `/setup` is shown. */
  const leavingAfterSaveRef = useRef(false)

  const initial = useMemo(() => {
    const s = scrapePreview?.suggested
    const site = scrapePreview?.websiteUrl ?? ''
    return {
      websiteUrl: site,
      businessName: String(s?.businessName ?? ''),
      industry: String(s?.industry ?? ''),
      services: Array.isArray(s?.services)
        ? s.services.filter((x): x is string => typeof x === 'string').join('\n')
        : '',
      serviceAreas: Array.isArray(s?.serviceAreas)
        ? s.serviceAreas.filter((x): x is string => typeof x === 'string').join('\n')
        : '',
      differentiators: String(s?.differentiators ?? ''),
      orderValueHint: String(s?.orderValueHint ?? ''),
      contactMethodsRaw: '',
      audienceSignalsRaw: '',
      goalsRaw: '',
    }
  }, [scrapePreview])

  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => setForm(initial), [initial])

  useEffect(() => {
    if (leavingAfterSaveRef.current) return
    if (!userId) navigate('/register', { replace: true })
    else if (!businessId || !scrapePreview) navigate('/onboarding/business', { replace: true })
  }, [userId, businessId, scrapePreview, navigate])

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!businessId) return
    setError(null)
    setBusy(true)
    try {
      const body: BusinessContextUpdateBody = {
        websiteUrl: form.websiteUrl.trim() || undefined,
        businessName: form.businessName.trim() || undefined,
        industry: form.industry.trim() || undefined,
        services: splitLines(form.services),
        serviceAreas: splitLines(form.serviceAreas),
        differentiators: form.differentiators.trim() || undefined,
        orderValueHint: form.orderValueHint.trim() || undefined,
      }

      try {
        const v = parseOptionalObject(form.contactMethodsRaw)
        if (v !== undefined) body.contactMethods = v
      } catch {
        throw new Error('Contact methods must be valid JSON or empty')
      }
      try {
        const v = parseOptionalObject(form.audienceSignalsRaw)
        if (v !== undefined) body.audienceSignals = v
      } catch {
        throw new Error('Audience signals must be valid JSON or empty')
      }
      try {
        const v = parseOptionalObject(form.goalsRaw)
        if (v !== undefined) body.goals = v
      } catch {
        throw new Error('Goals must be valid JSON or empty')
      }

      await updateBusinessContext(businessId, body)
      leavingAfterSaveRef.current = true
      navigate('/setup', { replace: true })
      window.setTimeout(() => {
        clearScrapePreviewState()
      }, 0)
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else if (err instanceof Error) setError(err.message)
      else setError('Could not save context')
    } finally {
      setBusy(false)
    }
  }

  if (!userId || !businessId || !scrapePreview) {
    return (
      <PageLayout title="Review">
        <InlineLoading />
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="Confirm business context"
      lead="Adjust any fields below. Saving confirms your context so setup can begin."
    >
      <form className="form" style={{ maxWidth: '32rem' }} onSubmit={(e) => void onSubmit(e)}>
        <ErrorAlert message={error} />
        <div className="field">
          <label htmlFor="websiteUrl">Website URL</label>
          <input
            id="websiteUrl"
            value={form.websiteUrl}
            onChange={(e) => setForm((f) => ({ ...f, websiteUrl: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="businessName">Business name</label>
          <input
            id="businessName"
            value={form.businessName}
            onChange={(e) => setForm((f) => ({ ...f, businessName: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="industry">Industry</label>
          <input
            id="industry"
            value={form.industry}
            onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="services">Services (one per line)</label>
          <textarea
            id="services"
            value={form.services}
            onChange={(e) => setForm((f) => ({ ...f, services: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="serviceAreas">Service areas (one per line)</label>
          <textarea
            id="serviceAreas"
            value={form.serviceAreas}
            onChange={(e) => setForm((f) => ({ ...f, serviceAreas: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="differentiators">Differentiators</label>
          <textarea
            id="differentiators"
            value={form.differentiators}
            onChange={(e) => setForm((f) => ({ ...f, differentiators: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="orderValueHint">Order value hint</label>
          <input
            id="orderValueHint"
            value={form.orderValueHint}
            onChange={(e) => setForm((f) => ({ ...f, orderValueHint: e.target.value }))}
          />
        </div>
        <details style={{ marginTop: '0.5rem' }}>
          <summary
            style={{ cursor: 'pointer', fontSize: '0.9rem', color: 'var(--color-muted)' }}
          >
            Optional JSON fields
          </summary>
          <div className="field" style={{ marginTop: '0.75rem' }}>
            <label htmlFor="contactMethodsRaw">contactMethods (JSON)</label>
            <textarea
              id="contactMethodsRaw"
              value={form.contactMethodsRaw}
              placeholder="{}"
              onChange={(e) => setForm((f) => ({ ...f, contactMethodsRaw: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="audienceSignalsRaw">audienceSignals (JSON)</label>
            <textarea
              id="audienceSignalsRaw"
              value={form.audienceSignalsRaw}
              placeholder="{}"
              onChange={(e) => setForm((f) => ({ ...f, audienceSignalsRaw: e.target.value }))}
            />
          </div>
          <div className="field">
            <label htmlFor="goalsRaw">goals (JSON)</label>
            <textarea
              id="goalsRaw"
              value={form.goalsRaw}
              placeholder="{}"
              onChange={(e) => setForm((f) => ({ ...f, goalsRaw: e.target.value }))}
            />
          </div>
        </details>
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <InlineLoading label="Saving…" /> : 'Confirm & continue'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/onboarding/suggestions')}
          >
            Back
          </button>
        </div>
      </form>
    </PageLayout>
  )
}
