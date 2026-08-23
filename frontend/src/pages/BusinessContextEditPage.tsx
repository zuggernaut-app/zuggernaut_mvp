import { type FormEvent, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { getBusinessContext, updateBusinessContext } from '../api/businessContexts'
import type { AdsReadinessIssue, BusinessContextUpdateBody } from '../types/api'
import { adsReadinessIssueMessages } from '../lib/businessContextAdsReadinessUi'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'

function splitLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function readPrimaryGoal(goals: unknown): string {
  if (!goals || typeof goals !== 'object' || Array.isArray(goals)) return ''
  const primary = (goals as Record<string, unknown>).primary
  return typeof primary === 'string' ? primary : ''
}

export function BusinessContextEditPage(): ReactElement {
  const navigate = useNavigate()
  const { businessId } = useParams<{ businessId: string }>()
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [readinessIssues, setReadinessIssues] = useState<AdsReadinessIssue[]>([])
  const [form, setForm] = useState({
    websiteUrl: '',
    businessName: '',
    industry: '',
    services: '',
    serviceAreas: '',
    differentiators: '',
    orderValueHint: '',
    thankYouUrls: '',
    primaryGoal: '',
  })

  useEffect(() => {
    if (!businessId) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const { businessContext } = await getBusinessContext(businessId)
        if (cancelled) return
        setForm({
          websiteUrl: businessContext.websiteUrl ?? '',
          businessName: businessContext.businessName ?? '',
          industry: businessContext.industry ?? '',
          services: (businessContext.services ?? []).join('\n'),
          serviceAreas: (businessContext.serviceAreas ?? []).join('\n'),
          differentiators: businessContext.differentiators ?? '',
          orderValueHint: businessContext.orderValueHint ?? '',
          thankYouUrls: (businessContext.thankYouUrls ?? []).join('\n'),
          primaryGoal: readPrimaryGoal(businessContext.goals),
        })
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiError) setError(err.message)
        else setError('Could not load business profile.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [businessId])

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!businessId) return
    setError(null)
    setReadinessIssues([])

    if (!form.businessName.trim()) {
      setError('Business name is required.')
      return
    }
    const primaryGoal = 'forms'

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
        thankYouUrls: splitLines(form.thankYouUrls),
        goals: { primary: primaryGoal },
      }
      const saved = await updateBusinessContext(businessId, body)
      if (!saved.adsReadiness.ok) {
        setReadinessIssues(saved.adsReadiness.issues)
        setError('Complete the required fields below.')
        return
      }
      navigate(-1)
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else if (err instanceof Error) setError(err.message)
      else setError('Could not save business profile.')
    } finally {
      setBusy(false)
    }
  }

  if (!businessId) {
    return (
      <PageLayout title="Edit business profile">
        <ErrorAlert message="Missing business id." />
      </PageLayout>
    )
  }

  if (loading) {
    return (
      <PageLayout title="Edit business profile">
        <InlineLoading />
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="Edit business profile"
      lead="Updates apply in Zuggernaut only. Google Ads and GTM are not changed automatically."
    >
      <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
        Changes here update your Zuggernaut business profile only. Existing Google Ads campaigns and
        GTM tags are not modified. Start a new setup run if you need Google resources updated.
      </div>

      <form className="form" style={{ maxWidth: '32rem' }} onSubmit={(e) => void onSubmit(e)}>
        <ErrorAlert message={error} />
        {readinessIssues.length > 0 ? (
          <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
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
          <label htmlFor="thankYouUrls">Thank-you page URL paths (one per line)</label>
          <textarea
            id="thankYouUrls"
            placeholder="/thank-you&#10;/contact/success"
            value={form.thankYouUrls}
            onChange={(e) => setForm((f) => ({ ...f, thankYouUrls: e.target.value }))}
          />
          <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginTop: '0.35rem' }}>
            Path or URL fragment matched in GTM when a form submission completes. Leave blank to use a
            default /thank path based on your website URL.
          </p>
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
          <span style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem' }}>
            Primary business goal
          </span>
          <p style={{ margin: 0, color: 'var(--color-muted)' }}>
            We&apos;ll optimize for form submissions.
          </p>
        </div>
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <InlineLoading label="Saving…" /> : 'Save changes'}
          </button>
          <Link className="btn btn-secondary" to="/setup">
            Cancel
          </Link>
        </div>
      </form>
    </PageLayout>
  )
}
