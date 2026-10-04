import { type FormEvent, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { getOnboardingScrapeSuggestions, submitIntake } from '../api/onboarding'
import { getBusinessContext } from '../api/businessContexts'
import { ApiError } from '../api/client'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import { isQuestionsComplete } from '../lib/onboardingRouting'
import { notifyOnboardingStorageChanged, useOnboardingState } from '../hooks/useOnboardingState'
import {
  clearIntakeDraft,
  clearOnboardingDrafts,
  getIntakeDraft,
  setIntakeDraft,
  type IntakeDraftFields,
} from '../utils/storage'

function intakeDraftSnapshot(fields: IntakeDraftFields): IntakeDraftFields {
  return { ...fields }
}

function hintText(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (Array.isArray(value)) {
    const parts = value.map((entry) => String(entry ?? '').trim()).filter(Boolean)
    return parts.length > 0 ? parts.join(', ') : null
  }
  return null
}

function websitePhoneHint(suggested: Record<string, unknown>): string | null {
  const contactMethods = suggested.contactMethods
  if (!contactMethods || typeof contactMethods !== 'object') return null
  const phones = (contactMethods as { phones?: unknown }).phones
  if (!Array.isArray(phones)) return null
  const parts = phones.map((phone) => String(phone ?? '').trim()).filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}

function FieldHint({ text }: { text: string }): ReactElement {
  return (
    <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', margin: '0.25rem 0 0' }}>
      {text}
    </p>
  )
}

export function BusinessStartPage(): ReactElement {
  const navigate = useNavigate()
  const location = useLocation()
  const editMode = (location.state as { editMode?: boolean } | null)?.editMode === true
  const { snapshot } = useOnboardingState()
  const businessId = snapshot.businessId

  const [businessName, setBusinessName] = useState('')
  const [primaryOffer, setPrimaryOffer] = useState('')
  const [serviceArea, setServiceArea] = useState('')
  const [whoBuysToday, setWhoBuysToday] = useState('')
  const [orderValueHint, setOrderValueHint] = useState('')
  const [howBuyersContact, setHowBuyersContact] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [intakeDraftHydrated, setIntakeDraftHydrated] = useState(false)
  const [scrapeHints, setScrapeHints] = useState<Record<string, unknown> | null>(null)
  const [contextLoading, setContextLoading] = useState(true)

  useEffect(() => {
    if (!businessId) {
      navigate('/onboarding/accounts', { replace: true })
      return
    }
    let cancelled = false
    void (async () => {
      setContextLoading(true)
      try {
        const res = await getBusinessContext(businessId)
        if (!cancelled) {
          if (!editMode && isQuestionsComplete(res.businessContext)) {
            navigate('/onboarding/thank-you', { replace: true })
            return
          }
          if (!res.businessContext.accountLinksCompletedAt) {
            navigate('/onboarding/accounts', { replace: true, state: { editMode: true } })
          }
        }
      } catch (err) {
        if (!cancelled && err instanceof ApiError && err.status === 404) {
          clearOnboardingDrafts()
          notifyOnboardingStorageChanged()
          navigate('/onboarding/accounts', { replace: true })
        }
      } finally {
        if (!cancelled) setContextLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [businessId, navigate, editMode])

  useEffect(() => {
    if (!businessId) {
      setIntakeDraftHydrated(false)
      return
    }
    const draft = getIntakeDraft(businessId)
    if (draft) {
      setBusinessName(draft.businessName)
      setPrimaryOffer(draft.primaryOffer)
      setServiceArea(draft.serviceArea)
      setWhoBuysToday(draft.whoBuysToday)
      setOrderValueHint(draft.orderValueHint)
      setHowBuyersContact(draft.howBuyersContact)
    }
    setIntakeDraftHydrated(true)
  }, [businessId])

  useEffect(() => {
    if (!businessId || !intakeDraftHydrated) return
    let cancelled = false
    void (async () => {
      try {
        const res = await getOnboardingScrapeSuggestions(businessId)
        if (!cancelled && res.suggested) {
          setScrapeHints(res.suggested)
        }
      } catch {
        // Hints are optional; never block intake.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [businessId, intakeDraftHydrated])

  useEffect(() => {
    if (!businessId || !intakeDraftHydrated) return
    setIntakeDraft(
      businessId,
      intakeDraftSnapshot({
        businessName,
        primaryOffer,
        serviceArea,
        whoBuysToday,
        orderValueHint,
        howBuyersContact,
      }),
    )
  }, [
    businessId,
    intakeDraftHydrated,
    businessName,
    primaryOffer,
    serviceArea,
    whoBuysToday,
    orderValueHint,
    howBuyersContact,
  ])

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)

    if (!businessId) return

    setBusy(true)
    try {
      await submitIntake(businessId, {
        businessName: businessName.trim(),
        primaryOffer: primaryOffer.trim(),
        whoBuysToday: whoBuysToday.trim(),
        serviceArea: serviceArea.trim(),
        orderValueHint: orderValueHint.trim() || undefined,
        howBuyersContact: howBuyersContact.trim(),
      })

      clearIntakeDraft(businessId)
      navigate('/onboarding/thank-you', { replace: true })
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not save your details.')
    } finally {
      setBusy(false)
    }
  }

  if (contextLoading || !businessId) {
    return (
      <PageLayout title="Tell us about your business">
        <InlineLoading label="Loading…" />
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="Tell us about your business"
      lead="Answer what you can — everything here is optional. An expert will follow up."
    >
      <form className="form" onSubmit={(e) => void onSubmit(e)}>
        <ErrorAlert message={error} />

        <div className="field">
          <label htmlFor="businessName">Business name</label>
          <input
            id="businessName"
            name="businessName"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
          />
          {scrapeHints && hintText(scrapeHints.businessName) ? (
            <FieldHint text={hintText(scrapeHints.businessName)!} />
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="primaryOffer">What you sell</label>
          <input
            id="primaryOffer"
            name="primaryOffer"
            placeholder="e.g. Residential plumbing services"
            value={primaryOffer}
            onChange={(e) => setPrimaryOffer(e.target.value)}
          />
          {scrapeHints && hintText(scrapeHints.services) ? (
            <FieldHint text={hintText(scrapeHints.services)!} />
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="whoBuysToday">Who buys from you today</label>
          <input
            id="whoBuysToday"
            name="whoBuysToday"
            placeholder="e.g. Homeowners with urgent plumbing issues"
            value={whoBuysToday}
            onChange={(e) => setWhoBuysToday(e.target.value)}
          />
          {scrapeHints && hintText(scrapeHints.whoBuysToday) ? (
            <FieldHint text={hintText(scrapeHints.whoBuysToday)!} />
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="serviceArea">Where you serve</label>
          <input
            id="serviceArea"
            name="serviceArea"
            placeholder="e.g. Austin, TX and surrounding areas"
            value={serviceArea}
            onChange={(e) => setServiceArea(e.target.value)}
          />
          {scrapeHints && hintText(scrapeHints.serviceAreas) ? (
            <FieldHint text={hintText(scrapeHints.serviceAreas)!} />
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="orderValueHint">Typical order value (optional)</label>
          <input
            id="orderValueHint"
            name="orderValueHint"
            placeholder="e.g. $500–$1,500"
            value={orderValueHint}
            onChange={(e) => setOrderValueHint(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="howBuyersContact">How buyers contact you</label>
          <input
            id="howBuyersContact"
            name="howBuyersContact"
            placeholder="e.g. Phone calls and contact form"
            value={howBuyersContact}
            onChange={(e) => setHowBuyersContact(e.target.value)}
          />
          {scrapeHints && websitePhoneHint(scrapeHints) ? (
            <FieldHint text={websitePhoneHint(scrapeHints)!} />
          ) : null}
        </div>

        <div className="actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() =>
              navigate('/onboarding/accounts', { replace: true, state: { editMode: true } })
            }
          >
            Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <InlineLoading label="Submitting…" /> : 'Submit'}
          </button>
        </div>
      </form>
    </PageLayout>
  )
}
