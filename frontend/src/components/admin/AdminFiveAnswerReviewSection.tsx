import { type FormEvent, useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import { ApiError } from '../../api/client'
import { adminApplyFactCheck } from '../../api/adminLeadCampaigns'
import type { BusinessContextDto } from '../../types/api'
import { ErrorAlert } from '../feedback/ErrorAlert'
import { InlineLoading } from '../feedback/InlineLoading'
import { splitLines } from './adminWorkspaceUtils'

const FIVE_ANSWER_KEYS = [
  'services',
  'whoBuysToday',
  'serviceAreas',
  'orderValueHint',
  'howBuyersContact',
] as const

interface AdminFiveAnswerReviewSectionProps {
  businessId: string
  initial: BusinessContextDto
  onSaved: (businessContext: BusinessContextDto) => void
}

function sourceLabel(source: string | undefined): string {
  if (source === 'operator') return 'Operator'
  if (source === 'customer') return 'Customer'
  if (source === 'ai_guess') return 'AI guess'
  return 'Unset'
}

export function AdminFiveAnswerReviewSection({
  businessId,
  initial,
  onSaved,
}: AdminFiveAnswerReviewSectionProps): ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedNotice, setSavedNotice] = useState<string | null>(null)
  const [form, setForm] = useState({
    services: '',
    whoBuysToday: '',
    serviceAreas: '',
    orderValueHint: '',
    howBuyersContact: '',
  })

  useEffect(() => {
    setForm({
      services: (initial.services ?? []).join('\n'),
      whoBuysToday: initial.whoBuysToday ?? '',
      serviceAreas: (initial.serviceAreas ?? []).join('\n'),
      orderValueHint: initial.orderValueHint ?? '',
      howBuyersContact: initial.howBuyersContact ?? '',
    })
  }, [initial])

  const sources = initial.intakeFieldSources ?? {}
  const submissions = initial.intakeSubmissions ?? []

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setSavedNotice(null)
    setBusy(true)
    try {
      await adminApplyFactCheck(businessId, {
        services: splitLines(form.services),
        whoBuysToday: form.whoBuysToday.trim(),
        serviceAreas: splitLines(form.serviceAreas),
        orderValueHint: form.orderValueHint.trim(),
        howBuyersContact: form.howBuyersContact.trim(),
      })
      const nextSources = { ...sources }
      for (const key of FIVE_ANSWER_KEYS) {
        nextSources[key] = 'operator'
      }
      onSaved({
        ...initial,
        services: splitLines(form.services),
        whoBuysToday: form.whoBuysToday.trim() || null,
        serviceAreas: splitLines(form.serviceAreas),
        orderValueHint: form.orderValueHint.trim() || null,
        howBuyersContact: form.howBuyersContact.trim() || null,
        intakeFieldSources: nextSources,
      })
      setSavedNotice('Five answers saved and marked operator-reviewed.')
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not save five-answer review.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <h2>Five-answer review</h2>
      <p style={{ color: 'var(--color-muted)', marginTop: 0 }}>
        Review what they sell, who buys, where they serve, order value, and how buyers contact
        before the confirmation call.
      </p>
      <ErrorAlert message={error} />
      {savedNotice ? (
        <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
          {savedNotice}
        </div>
      ) : null}
      {submissions.length > 0 ? (
        <div style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginTop: 0 }}>Customer submission history</h3>
          <ul style={{ paddingLeft: '1.25rem', margin: 0 }}>
            {submissions.map((entry, index) => {
              const fields = entry.fields ?? {}
              const label =
                typeof entry.submittedAt === 'string' && entry.submittedAt
                  ? new Date(entry.submittedAt).toLocaleString()
                  : `Submission ${index + 1}`
              const businessName =
                typeof fields.businessName === 'string' ? fields.businessName : null
              const services = Array.isArray(fields.services)
                ? fields.services.map((s) => String(s)).join(', ')
                : null
              return (
                <li key={`${entry.submittedAt ?? 'submission'}-${index}`} style={{ marginBottom: '0.75rem' }}>
                  <strong>{label}</strong>
                  <div style={{ color: 'var(--color-muted)', fontSize: '0.9rem' }}>
                    {businessName ? `Business: ${businessName}` : 'Business: —'}
                    {services ? ` · Offer: ${services}` : ''}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ) : null}
      <form className="form" style={{ maxWidth: '32rem' }} onSubmit={(e) => void onSubmit(e)}>
        <div className="field">
          <label htmlFor="five-services">
            What they sell{' '}
            <span style={{ color: 'var(--color-muted)' }}>({sourceLabel(sources.services)})</span>
          </label>
          <textarea
            id="five-services"
            value={form.services}
            onChange={(e) => setForm((f) => ({ ...f, services: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="five-who-buys">
            Who buys today{' '}
            <span style={{ color: 'var(--color-muted)' }}>
              ({sourceLabel(sources.whoBuysToday)})
            </span>
          </label>
          <input
            id="five-who-buys"
            value={form.whoBuysToday}
            onChange={(e) => setForm((f) => ({ ...f, whoBuysToday: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="five-service-areas">
            Where they serve{' '}
            <span style={{ color: 'var(--color-muted)' }}>
              ({sourceLabel(sources.serviceAreas)})
            </span>
          </label>
          <textarea
            id="five-service-areas"
            value={form.serviceAreas}
            onChange={(e) => setForm((f) => ({ ...f, serviceAreas: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="five-order-value">
            Order value hint{' '}
            <span style={{ color: 'var(--color-muted)' }}>
              ({sourceLabel(sources.orderValueHint)})
            </span>
          </label>
          <input
            id="five-order-value"
            value={form.orderValueHint}
            onChange={(e) => setForm((f) => ({ ...f, orderValueHint: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="five-contact">
            How buyers contact{' '}
            <span style={{ color: 'var(--color-muted)' }}>
              ({sourceLabel(sources.howBuyersContact)})
            </span>
          </label>
          <input
            id="five-contact"
            value={form.howBuyersContact}
            onChange={(e) => setForm((f) => ({ ...f, howBuyersContact: e.target.value }))}
          />
        </div>
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <InlineLoading label="Saving…" /> : 'Save five-answer review'}
          </button>
        </div>
      </form>
    </section>
  )
}

export function fiveAnswersOperatorReviewed(
  sources: Record<string, string> | null | undefined,
): boolean {
  if (!sources) return false
  return FIVE_ANSWER_KEYS.every((key) => sources[key] === 'operator')
}
