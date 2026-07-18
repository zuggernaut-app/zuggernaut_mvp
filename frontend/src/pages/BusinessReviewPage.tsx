import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { updateBusinessContext } from '../api/businessContexts'
import type { AdsReadinessIssue, BusinessContextUpdateBody } from '../types/api'
import { adsReadinessIssueMessages } from '../lib/businessContextAdsReadinessUi'
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

function contactFromSuggested(contact: unknown): { email: string; phone: string } {
  if (!contact || typeof contact !== 'object') return { email: '', phone: '' }
  const c = contact as Record<string, unknown>
  const email = Array.isArray(c.emails) && c.emails[0] ? String(c.emails[0]) : ''
  const phone = Array.isArray(c.phones) && c.phones[0] ? String(c.phones[0]) : ''
  return { email, phone }
}

function buildContactMethods(
  email: string,
  phone: string,
  rawJson: string,
): unknown | undefined {
  if (rawJson.trim()) {
    return parseOptionalObject(rawJson)
  }
  const contact: Record<string, string[]> = {}
  const trimmedEmail = email.trim()
  const trimmedPhone = phone.trim()
  if (trimmedEmail) contact.emails = [trimmedEmail]
  if (trimmedPhone) contact.phones = [trimmedPhone]
  return Object.keys(contact).length ? contact : undefined
}

function readPrimaryGoal(goals: unknown): string {
  if (!goals || typeof goals !== 'object' || Array.isArray(goals)) return ''
  const primary = (goals as Record<string, unknown>).primary
  return typeof primary === 'string' ? primary : ''
}

export function BusinessReviewPage(): ReactElement {
  const navigate = useNavigate()
  const { snapshot, clearScrapePreviewState } = useOnboardingState()
  const { businessId, scrapePreview } = snapshot
  /** After successful PUT, scrape preview clears async; suppress redirect-to-business until `/setup` is shown. */
  const leavingAfterSaveRef = useRef(false)

  const initial = useMemo(() => {
    const s = scrapePreview?.suggested
    const site = scrapePreview?.websiteUrl ?? ''
    const contact = contactFromSuggested(s?.contactMethods)
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
      contactEmail: contact.email,
      contactPhone: contact.phone,
      contactMethodsRaw: s?.contactMethods ? JSON.stringify(s.contactMethods, null, 2) : '',
      audienceSignalsRaw: '',
      goalsRaw: s?.goals ? JSON.stringify(s.goals, null, 2) : '',
      primaryGoal: readPrimaryGoal(s?.goals),
    }
  }, [scrapePreview])

  const [form, setForm] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [readinessIssues, setReadinessIssues] = useState<AdsReadinessIssue[]>([])

  useEffect(() => setForm(initial), [initial])

  useEffect(() => {
    if (leavingAfterSaveRef.current) return
    if (!businessId || !scrapePreview) navigate('/onboarding/business', { replace: true })
  }, [businessId, scrapePreview, navigate])

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!businessId) return
    setError(null)
    setReadinessIssues([])

    if (!form.businessName.trim()) {
      setError('Business name is required to confirm your context.')
      return
    }
    if (!form.primaryGoal) {
      setError('Choose a primary business goal (calls, forms, or both).')
      return
    }

    setBusy(true)
    try {
      const body: BusinessContextUpdateBody = {
        websiteUrl: form.websiteUrl.trim() || undefined,
        businessName: form.businessName.trim(),
        industry: form.industry.trim() || undefined,
        services: splitLines(form.services),
        serviceAreas: splitLines(form.serviceAreas),
        differentiators: form.differentiators.trim() || undefined,
        orderValueHint: form.orderValueHint.trim() || undefined,
        goals: { primary: form.primaryGoal },
      }

      try {
        body.contactMethods = buildContactMethods(
          form.contactEmail,
          form.contactPhone,
          form.contactMethodsRaw,
        )
      } catch {
        throw new Error('Contact methods must be valid JSON or use the email/phone fields')
      }
      try {
        const v = parseOptionalObject(form.audienceSignalsRaw)
        if (v !== undefined) body.audienceSignals = v
      } catch {
        throw new Error('Audience signals must be valid JSON or empty')
      }
      try {
        const v = parseOptionalObject(form.goalsRaw)
        if (v !== undefined) {
          const merged =
            typeof v === 'object' && v !== null && !Array.isArray(v)
              ? { ...(v as Record<string, unknown>) }
              : {}
          // Dropdown selection wins over scraped/legacy goals JSON (e.g. generate_leads).
          body.goals = { ...merged, primary: form.primaryGoal }
        }
      } catch {
        throw new Error('Goals must be valid JSON or empty')
      }

      const saved = await updateBusinessContext(businessId, body)
      if (!saved.adsReadiness.ok) {
        setReadinessIssues(saved.adsReadiness.issues)
        setError('Complete the required fields below before setup can start.')
        return
      }
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

  if (!businessId || !scrapePreview) {
    return (
      <PageLayout title="Review">
        <InlineLoading />
      </PageLayout>
    )
  }

  const manualHint = scrapePreview.manualFallback || scrapePreview.scrapeQuality === 'none'

  return (
    <PageLayout
      title="Confirm business context"
      lead="Adjust any fields below. Saving confirms your context so Google setup can begin."
    >
      {manualHint ? (
        <section className="alert alert-info" style={{ marginBottom: '1rem' }}>
          Scrape was skipped or returned limited data. Fill in the details your customers should
          see in campaigns and audits.
        </section>
      ) : null}

      <form className="form" style={{ maxWidth: '32rem' }} onSubmit={(e) => void onSubmit(e)}>
        <ErrorAlert message={error} />
        {readinessIssues.length > 0 ? (
          <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
            <p style={{ margin: '0 0 0.5rem' }}>Before setup can start:</p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
              {adsReadinessIssueMessages({ ok: false, issues: readinessIssues }).map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}
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
          <label htmlFor="contactEmail">Contact email</label>
          <input
            id="contactEmail"
            type="email"
            value={form.contactEmail}
            onChange={(e) => setForm((f) => ({ ...f, contactEmail: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="contactPhone">Contact phone</label>
          <input
            id="contactPhone"
            type="tel"
            value={form.contactPhone}
            onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
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
        <div className="field">
          <label htmlFor="primaryGoal">Primary business goal</label>
          <select
            id="primaryGoal"
            value={form.primaryGoal}
            onChange={(e) => setForm((f) => ({ ...f, primaryGoal: e.target.value }))}
          >
            <option value="">Select a goal…</option>
            <option value="calls">Phone calls</option>
            <option value="forms">Form submissions</option>
            <option value="both">Calls and forms</option>
          </select>
        </div>
        <details style={{ marginTop: '0.5rem' }}>
          <summary
            style={{ cursor: 'pointer', fontSize: '0.9rem', color: 'var(--color-muted)' }}
          >
            Optional JSON fields
          </summary>
          <div className="field" style={{ marginTop: '0.75rem' }}>
            <label htmlFor="contactMethodsRaw">contactMethods (JSON override)</label>
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
          {scrapePreview.scrapeStatus !== 'MANUAL' ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate('/onboarding/suggestions')}
            >
              Back
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate('/onboarding/business')}
            >
              Back
            </button>
          )}
        </div>
      </form>
    </PageLayout>
  )
}
