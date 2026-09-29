import { type FormEvent, useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import { ApiError } from '../../api/client'
import { adminRecordSetupCall } from '../../api/adminLeadCampaigns'
import type { BusinessContextDto } from '../../types/api'
import { ErrorAlert } from '../feedback/ErrorAlert'
import { InlineLoading } from '../feedback/InlineLoading'
import { fiveAnswersOperatorReviewed } from './AdminFiveAnswerReviewSection'
import { readContactFromMethods } from './adminWorkspaceUtils'

const CONFIRMABLE_FIELDS = [
  { id: 'businessName', label: 'Business name' },
  { id: 'websiteUrl', label: 'Website' },
  { id: 'services', label: 'What they sell' },
  { id: 'serviceAreas', label: 'Where they serve' },
  { id: 'whoBuysToday', label: 'Who buys today' },
  { id: 'howBuyersContact', label: 'How buyers contact' },
] as const

interface AdminSetupCallSectionProps {
  businessId: string
  businessContext: BusinessContextDto
  onRecorded: (setupCallConfirmedAt: string) => void
}

export function AdminSetupCallSection({
  businessId,
  businessContext,
  onRecorded,
}: AdminSetupCallSectionProps): ReactElement {
  const contact = readContactFromMethods(businessContext.contactMethods)
  const [phone, setPhone] = useState(contact.phone)
  const [email, setEmail] = useState(contact.email)
  const [orderValueHint, setOrderValueHint] = useState(businessContext.orderValueHint ?? '')
  const [confirmedFields, setConfirmedFields] = useState<string[]>(['businessName'])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const nextContact = readContactFromMethods(businessContext.contactMethods)
    setPhone(nextContact.phone)
    setEmail(nextContact.email)
    setOrderValueHint(businessContext.orderValueHint ?? '')
  }, [businessContext])

  function toggleField(field: string): void {
    setConfirmedFields((prev) =>
      prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field],
    )
  }

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setNotice(null)

    if (!orderValueHint.trim()) {
      setError('Order value from the customer is required.')
      return
    }
    if (!phone.trim() || !email.trim()) {
      setError('Phone and email must be confirmed on the call.')
      return
    }

    setBusy(true)
    try {
      const result = await adminRecordSetupCall(businessId, {
        phone: phone.trim(),
        email: email.trim(),
        orderValueHint: orderValueHint.trim(),
        confirmedFields,
      })
      onRecorded(result.setupCallConfirmedAt)
      setNotice('Confirmation call recorded. Business setup is complete.')
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not record confirmation call.')
    } finally {
      setBusy(false)
    }
  }

  if (businessContext.setupCallConfirmedAt) {
    return (
      <section style={{ marginTop: '1.5rem' }}>
        <h2>Confirmation call</h2>
        <p style={{ color: 'var(--color-muted)' }}>
          Recorded {new Date(businessContext.setupCallConfirmedAt).toLocaleString()}.
        </p>
      </section>
    )
  }

  if (!fiveAnswersOperatorReviewed(businessContext.intakeFieldSources)) {
    return (
      <section style={{ marginTop: '1.5rem' }}>
        <h2>Confirmation call</h2>
        <p style={{ color: 'var(--color-muted)', marginTop: 0 }}>
          Complete the five-answer review above before recording the confirmation call.
        </p>
      </section>
    )
  }

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <h2>Confirmation call</h2>
      <p style={{ color: 'var(--color-muted)', marginTop: 0 }}>
        Confirm phone, email, and the customer&apos;s order value. Mark each fact the customer
        confirmed on the call.
      </p>
      <ErrorAlert message={error} />
      {notice ? <p role="status">{notice}</p> : null}
      <form className="form" style={{ maxWidth: '32rem' }} onSubmit={(e) => void onSubmit(e)}>
        <div className="field">
          <label htmlFor="setup-call-phone">Phone (confirmed)</label>
          <input
            id="setup-call-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="setup-call-email">Email (confirmed)</label>
          <input
            id="setup-call-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="setup-call-order-value">Order value (customer number)</label>
          <input
            id="setup-call-order-value"
            value={orderValueHint}
            onChange={(e) => setOrderValueHint(e.target.value)}
            placeholder="e.g. 500"
            required
          />
        </div>
        <fieldset className="field">
          <legend>Facts confirmed on the call</legend>
          {CONFIRMABLE_FIELDS.map((field) => (
            <label key={field.id} style={{ display: 'block', marginBottom: '0.35rem' }}>
              <input
                type="checkbox"
                checked={confirmedFields.includes(field.id)}
                onChange={() => toggleField(field.id)}
              />
              {field.label}
            </label>
          ))}
        </fieldset>
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <InlineLoading label="Saving…" /> : 'Record confirmation call'}
          </button>
        </div>
      </form>
    </section>
  )
}
