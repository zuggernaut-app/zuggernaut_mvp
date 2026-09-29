import { type FormEvent, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { createBusinessDraft, submitIntake } from '../api/onboarding'
import { getBusinessContext } from '../api/businessContexts'
import { ApiError } from '../api/client'
import { GoogleAdsCustomerSelector } from '../components/integrations/GoogleAdsCustomerSelector'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import type { IntegrationConnectionStatusDto } from '../api/integrations'
import { useIntegrationConnections } from '../hooks/useIntegrationConnections'
import { notifyOnboardingStorageChanged, useOnboardingState } from '../hooks/useOnboardingState'
import {
  clearIntakeDraft,
  clearOnboardingDrafts,
  getIntakeDraft,
  setIntakeDraft,
  type IntakeDraftFields,
} from '../utils/storage'
import {
  isValidEmail,
  isValidPhone,
  MAX_URL_LENGTH,
  validateHttpUrl,
} from '../utils/validation'

const INTAKE_RETURN_PATH = '/onboarding/business'

function needsOAuthConnect(reason: string | undefined): boolean {
  return (
    reason === 'missing_connection' ||
    reason === 'not_connected' ||
    reason === 'needs_reauth' ||
    reason === 'insufficient_scopes' ||
    reason === 'token_expired' ||
    reason === 'missing_tokens'
  )
}

/** Intake: OAuth + account selected; MCC link not required before submit. */
function googleAdsReadyForIntake(status: IntegrationConnectionStatusDto | undefined): boolean {
  if (!status) return false
  if (status.reason === 'selection_required') return false
  if (needsOAuthConnect(status.reason)) return false
  if (status.ready) return true
  const customerId = status.providerIdentifiers?.customerId
  if (
    typeof customerId === 'string' &&
    customerId &&
    (status.reason === 'mcc_link_required' || status.reason === 'mcc_link_pending')
  ) {
    return true
  }
  return false
}

function intakeDraftSnapshot(fields: IntakeDraftFields): IntakeDraftFields {
  return { ...fields }
}

export function BusinessStartPage(): ReactElement {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { snapshot, setBusinessId } = useOnboardingState()
  const businessId = snapshot.businessId

  const [websiteUrl, setWebsiteUrl] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [primaryOffer, setPrimaryOffer] = useState('')
  const [serviceArea, setServiceArea] = useState('')
  const [whoBuysToday, setWhoBuysToday] = useState('')
  const [orderValueHint, setOrderValueHint] = useState('')
  const [howBuyersContact, setHowBuyersContact] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [draftBusy, setDraftBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [integrationNotice, setIntegrationNotice] = useState<string | null>(null)
  const [intakeDraftHydrated, setIntakeDraftHydrated] = useState(false)

  const {
    connections,
    loading: connectionsLoading,
    error: connectionsError,
    refetch: refetchConnections,
    connectProvider,
    statusLabel,
  } = useIntegrationConnections(businessId)

  const googleAds = connections.google_ads
  const googleAdsReadyForSubmit = googleAdsReadyForIntake(googleAds)
  const adsNeedsSelection = googleAds?.reason === 'selection_required'

  useEffect(() => {
    if (!businessId) return
    let cancelled = false
    void (async () => {
      try {
        const res = await getBusinessContext(businessId)
        if (!cancelled && res.businessContext.confirmedAt) {
          navigate('/onboarding/thank-you', { replace: true })
        }
      } catch (err) {
        if (!cancelled && err instanceof ApiError && err.status === 404) {
          clearOnboardingDrafts()
          notifyOnboardingStorageChanged()
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [businessId, navigate])

  useEffect(() => {
    if (businessId) return
    let cancelled = false
    void (async () => {
      setDraftBusy(true)
      try {
        const draft = await createBusinessDraft()
        if (!cancelled) setBusinessId(draft.businessId)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not start intake.')
        }
      } finally {
        if (!cancelled) setDraftBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [businessId, setBusinessId])

  useEffect(() => {
    if (!businessId) {
      setIntakeDraftHydrated(false)
      return
    }
    const draft = getIntakeDraft(businessId)
    if (draft) {
      setWebsiteUrl(draft.websiteUrl)
      setBusinessName(draft.businessName)
      setPrimaryOffer(draft.primaryOffer)
      setServiceArea(draft.serviceArea)
      setWhoBuysToday(draft.whoBuysToday)
      setOrderValueHint(draft.orderValueHint)
      setHowBuyersContact(draft.howBuyersContact)
      setPhone(draft.phone)
      setEmail(draft.email)
    }
    setIntakeDraftHydrated(true)
  }, [businessId])

  useEffect(() => {
    if (!businessId || !intakeDraftHydrated) return
    setIntakeDraft(
      businessId,
      intakeDraftSnapshot({
        websiteUrl,
        businessName,
        primaryOffer,
        serviceArea,
        whoBuysToday,
        orderValueHint,
        howBuyersContact,
        phone,
        email,
      }),
    )
  }, [
    businessId,
    intakeDraftHydrated,
    websiteUrl,
    businessName,
    primaryOffer,
    serviceArea,
    whoBuysToday,
    orderValueHint,
    howBuyersContact,
    phone,
    email,
  ])

  function persistIntakeDraftNow(): void {
    if (!businessId) return
    setIntakeDraft(
      businessId,
      intakeDraftSnapshot({
        websiteUrl,
        businessName,
        primaryOffer,
        serviceArea,
        whoBuysToday,
        orderValueHint,
        howBuyersContact,
        phone,
        email,
      }),
    )
  }

  function handleConnectGoogleAds(): void {
    persistIntakeDraftNow()
    void connectProvider('google_ads', INTAKE_RETURN_PATH)
  }

  useEffect(() => {
    const integration = searchParams.get('integration')
    const provider = searchParams.get('provider')
    const reason = searchParams.get('reason')
    if (!integration) return

    if (integration === 'connected' && provider) {
      setIntegrationNotice(
        provider === 'google_ads'
          ? 'Google Ads connected. Select your account below, then submit.'
          : `${provider} connected successfully.`,
      )
      void refetchConnections()
    } else if (integration === 'error') {
      setIntegrationNotice(
        reason ? `Google connection failed (${reason}).` : 'Google connection failed.',
      )
    }

    const next = new URLSearchParams(searchParams)
    next.delete('integration')
    next.delete('provider')
    next.delete('reason')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, refetchConnections])

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)

    if (!phone.trim() || !isValidPhone(phone)) {
      setError('A valid phone number is required.')
      return
    }
    if (!email.trim() || !isValidEmail(email)) {
      setError('A valid email address is required.')
      return
    }

    const websiteTrimmed = websiteUrl.trim()
    if (!websiteTrimmed) {
      setError('Website URL is required.')
      return
    }
    const urlCheck = validateHttpUrl(websiteTrimmed)
    if (!urlCheck.ok) {
      setError(urlCheck.message)
      return
    }
    const normalizedWebsite = urlCheck.value

    if (!googleAdsReadyForSubmit) {
      if (!googleAds || needsOAuthConnect(googleAds.reason)) {
        setError('Connect Google Ads before submitting.')
        return
      }
      if (adsNeedsSelection) {
        setError('Select your Google Ads account before submitting.')
        return
      }
      setError('Google Ads must be connected and account selected before submitting.')
      return
    }

    setBusy(true)
    try {
      let activeBusinessId = businessId
      if (!activeBusinessId) {
        const draft = await createBusinessDraft()
        activeBusinessId = draft.businessId
        setBusinessId(activeBusinessId)
      }

      await submitIntake(activeBusinessId, {
        websiteUrl: normalizedWebsite,
        businessName: businessName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        primaryOffer: primaryOffer.trim(),
        whoBuysToday: whoBuysToday.trim(),
        serviceArea: serviceArea.trim(),
        orderValueHint: orderValueHint.trim() || undefined,
        howBuyersContact: howBuyersContact.trim(),
      })

      clearIntakeDraft(activeBusinessId)
      navigate('/onboarding/thank-you', { replace: true })
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not save your details.')
    } finally {
      setBusy(false)
    }
  }

  const canSubmit =
    Boolean(businessId) &&
    !draftBusy &&
    !busy &&
    googleAdsReadyForSubmit &&
    websiteUrl.trim() &&
    isValidPhone(phone) &&
    isValidEmail(email)

  return (
    <PageLayout
      title="Tell us about your business"
      lead="Share the basics and connect Google Ads. We'll handle the rest."
    >
      {draftBusy && !businessId ? <InlineLoading label="Preparing intake…" /> : null}
      <form className="form" onSubmit={(e) => void onSubmit(e)}>
        <ErrorAlert message={error ?? connectionsError} />
        {integrationNotice ? (
          <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
            {integrationNotice}
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="websiteUrl">Website URL</label>
          <input
            id="websiteUrl"
            name="websiteUrl"
            type="url"
            required
            placeholder="https://example.com"
            maxLength={MAX_URL_LENGTH}
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="businessName">Business name</label>
          <input
            id="businessName"
            name="businessName"
            required
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="primaryOffer">What you sell</label>
          <input
            id="primaryOffer"
            name="primaryOffer"
            required
            placeholder="e.g. Residential plumbing services"
            value={primaryOffer}
            onChange={(e) => setPrimaryOffer(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="whoBuysToday">Who buys from you today</label>
          <input
            id="whoBuysToday"
            name="whoBuysToday"
            required
            placeholder="e.g. Homeowners with urgent plumbing issues"
            value={whoBuysToday}
            onChange={(e) => setWhoBuysToday(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="serviceArea">Where you serve</label>
          <input
            id="serviceArea"
            name="serviceArea"
            required
            placeholder="e.g. Austin, TX and surrounding areas"
            value={serviceArea}
            onChange={(e) => setServiceArea(e.target.value)}
          />
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
            required
            placeholder="e.g. Phone calls and contact form"
            value={howBuyersContact}
            onChange={(e) => setHowBuyersContact(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="phone">Phone</label>
          <input
            id="phone"
            name="phone"
            type="tel"
            required
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        <section style={{ marginTop: '1.5rem', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Google Ads (required)</h2>
          {connectionsLoading && !googleAds ? <InlineLoading label="Loading connection…" /> : null}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
            <span
              className={`statusPill ${googleAdsReadyForSubmit ? 'status-succeeded' : 'status-review'}`}
            >
              {googleAds ? statusLabel(googleAds) : 'Loading…'}
            </span>
            {googleAds && !googleAdsReadyForSubmit && needsOAuthConnect(googleAds.reason) ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!businessId || draftBusy}
                onClick={handleConnectGoogleAds}
              >
                Connect Google
              </button>
            ) : null}
          </div>
          {adsNeedsSelection && businessId ? (
            <GoogleAdsCustomerSelector
              businessId={businessId}
              onSaved={() => void refetchConnections()}
            />
          ) : null}
          {!googleAdsReadyForSubmit ? (
            <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginTop: '0.75rem' }}>
              {adsNeedsSelection
                ? 'Select your Google Ads customer account before submitting.'
                : 'Connect Google Ads and select your account before submitting.'}
            </p>
          ) : googleAds?.providerIdentifiers?.customerId ? (
            <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: 'var(--color-muted)' }}>
              Customer: {String(googleAds.providerIdentifiers.customerId)}
            </p>
          ) : null}
        </section>

        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={!canSubmit}>
            {busy ? <InlineLoading label="Submitting…" /> : 'Submit'}
          </button>
        </div>
      </form>
    </PageLayout>
  )
}
