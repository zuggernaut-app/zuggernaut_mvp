import { type FormEvent, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { ApiError } from '../../api/client'
import { adminApplyFactCheck } from '../../api/adminLeadCampaigns'
import { updateBusinessContext } from '../../api/businessContexts'
import type { BusinessContextDto, BusinessContextUpdateBody } from '../../types/api'
import { ErrorAlert } from '../feedback/ErrorAlert'
import { InlineLoading } from '../feedback/InlineLoading'
import {
  buildContactMethods,
  readContactFromMethods,
  splitLines,
} from './adminWorkspaceUtils'

interface AdminBusinessSetupSectionProps {
  businessId: string
  initial: BusinessContextDto
  onSaved: (businessContext: BusinessContextDto) => void
}

export function AdminBusinessSetupSection({
  businessId,
  initial,
  onSaved,
}: AdminBusinessSetupSectionProps): ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedNotice, setSavedNotice] = useState<string | null>(null)
  const [form, setForm] = useState({
    websiteUrl: '',
    businessName: '',
    industry: '',
    serviceAreas: '',
    phone: '',
    email: '',
    businessCountry: '',
  })

  useEffect(() => {
    const contact = readContactFromMethods(initial.contactMethods)
    setForm({
      websiteUrl: initial.websiteUrl ?? '',
      businessName: initial.businessName ?? '',
      industry: initial.industry ?? '',
      serviceAreas: (initial.serviceAreas ?? []).join('\n'),
      phone: contact.phone,
      email: contact.email,
      businessCountry: initial.businessCountry ?? '',
    })
  }, [initial])

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setSavedNotice(null)

    if (!form.businessName.trim()) {
      setError('Business name is required.')
      return
    }

    setBusy(true)
    try {
      const body: BusinessContextUpdateBody = {
        businessName: form.businessName.trim(),
        websiteUrl: form.websiteUrl.trim() || undefined,
        industry: form.industry.trim() || undefined,
        serviceAreas: splitLines(form.serviceAreas),
        contactMethods: buildContactMethods(form.email, form.phone),
      }
      const saved = await updateBusinessContext(businessId, body)
      let nextContext = saved.businessContext
      const country = form.businessCountry.trim().toUpperCase()
      if (country) {
        await adminApplyFactCheck(businessId, { businessCountry: country })
        nextContext = { ...nextContext, businessCountry: country }
      }
      onSaved(nextContext)
      setSavedNotice('Business setup saved.')
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not save business setup.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form" style={{ maxWidth: '32rem' }} onSubmit={(e) => void onSubmit(e)}>
      <ErrorAlert message={error} />
      {savedNotice ? (
        <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
          {savedNotice}
        </div>
      ) : null}
      <div className="field">
        <label htmlFor="admin-businessName">Business name</label>
        <input
          id="admin-businessName"
          value={form.businessName}
          onChange={(e) => setForm((f) => ({ ...f, businessName: e.target.value }))}
        />
      </div>
      <div className="field">
        <label htmlFor="admin-websiteUrl">Website URL</label>
        <input
          id="admin-websiteUrl"
          value={form.websiteUrl}
          onChange={(e) => setForm((f) => ({ ...f, websiteUrl: e.target.value }))}
        />
      </div>
      <div className="field">
        <label htmlFor="admin-businessCountry">Business country (ISO code)</label>
        <input
          id="admin-businessCountry"
          value={form.businessCountry}
          onChange={(e) => setForm((f) => ({ ...f, businessCountry: e.target.value }))}
          placeholder="US"
          maxLength={2}
        />
        <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', margin: '0.35rem 0 0' }}>
          Saved via operator fact-check. Used for call-campaign eligibility.
        </p>
      </div>
      <div className="field">
        <label htmlFor="admin-industry">Industry</label>
        <input
          id="admin-industry"
          value={form.industry}
          onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
        />
      </div>
      <div className="field">
        <label htmlFor="admin-serviceAreas">Where you serve (one per line)</label>
        <textarea
          id="admin-serviceAreas"
          value={form.serviceAreas}
          onChange={(e) => setForm((f) => ({ ...f, serviceAreas: e.target.value }))}
        />
      </div>
      <div className="field">
        <label htmlFor="admin-phone">Phone</label>
        <input
          id="admin-phone"
          type="tel"
          value={form.phone}
          onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
        />
      </div>
      <div className="field">
        <label htmlFor="admin-email">Email</label>
        <input
          id="admin-email"
          type="email"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        />
      </div>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? <InlineLoading label="Saving…" /> : 'Save business setup'}
        </button>
      </div>
    </form>
  )
}
