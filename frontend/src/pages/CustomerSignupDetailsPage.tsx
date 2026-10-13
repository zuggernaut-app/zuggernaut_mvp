import { type FormEvent, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { completeCustomerSignupDetails, getBusinessContext } from '../api/businessContexts'
import { ApiError } from '../api/client'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import { useAuth } from '../hooks/useAuth'
import { notifyOnboardingStorageChanged, useOnboardingState } from '../hooks/useOnboardingState'
import {
  SIGNUP_ACCOUNT_CURRENCIES,
  browserTimeZoneId,
  currencyLabel,
  listCountryOptions,
  listTimeZoneOptions,
  preselectedCurrencyForCountry,
  type SignupAccountCurrency,
} from '../lib/signupAccount'
import { MAX_URL_LENGTH, validateCustomerSignupDetailsForm } from '../utils/validation'

export function CustomerSignupDetailsPage(): ReactElement {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { snapshot } = useOnboardingState()
  const businessId = snapshot.businessId ?? user?.primaryBusinessId ?? null

  const countryOptions = useMemo(() => listCountryOptions(), [])
  const timeZoneOptions = useMemo(() => listTimeZoneOptions(), [])

  const [businessName, setBusinessName] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [websiteFieldError, setWebsiteFieldError] = useState<string | null>(null)
  const [businessCountry, setBusinessCountry] = useState('')
  const [accountCurrencyCode, setAccountCurrencyCode] = useState<SignupAccountCurrency>('USD')
  const [accountTimeZone, setAccountTimeZone] = useState(() => browserTimeZoneId())
  const [whatYouSell, setWhatYouSell] = useState('')
  const [whoBuysToday, setWhoBuysToday] = useState('')
  const [whereTheyServe, setWhereTheyServe] = useState('')
  const [howBuyersContact, setHowBuyersContact] = useState('')
  const [orderValueHint, setOrderValueHint] = useState('')
  const [termsAccepted, setTermsAccepted] = useState(false)
  const [contextLoading, setContextLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!businessCountry) return
    setAccountCurrencyCode(preselectedCurrencyForCountry(businessCountry))
  }, [businessCountry])

  useEffect(() => {
    if (!businessId) {
      setContextLoading(false)
      return
    }

    let cancelled = false
    void (async () => {
      setContextLoading(true)
      try {
        const res = await getBusinessContext(businessId)
        const ctx = res.businessContext
        if (cancelled) return
        setBusinessName(ctx.businessName ?? '')
        setWebsiteUrl(ctx.websiteUrl ?? '')
        setBusinessCountry(ctx.businessCountry ?? '')
        if (ctx.accountCurrencyCode) {
          setAccountCurrencyCode(ctx.accountCurrencyCode as SignupAccountCurrency)
        }
        if (ctx.accountTimeZone) {
          setAccountTimeZone(ctx.accountTimeZone)
        } else if (!accountTimeZone) {
          setAccountTimeZone(browserTimeZoneId())
        }
        setWhatYouSell((ctx.services ?? []).join(', '))
        setWhoBuysToday(ctx.whoBuysToday ?? '')
        setWhereTheyServe((ctx.serviceAreas ?? []).join(', '))
        setHowBuyersContact(ctx.howBuyersContact ?? '')
        setOrderValueHint(ctx.orderValueHint ?? '')
        setTermsAccepted(Boolean(ctx.termsAcceptedAt))
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError) setError(err.message)
          else setError('Could not load your business details.')
        }
      } finally {
        if (!cancelled) setContextLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [businessId])

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setWebsiteFieldError(null)

    const form = validateCustomerSignupDetailsForm({
      businessName,
      websiteUrl,
      termsAccepted,
      businessCountry,
      accountCurrencyCode,
      accountTimeZone,
    })
    if (!form.ok) {
      setError(form.message)
      if (form.field === 'websiteUrl') {
        setWebsiteFieldError(form.message)
      }
      return
    }

    if (!businessId) {
      setError('No business is selected. Try logging in again.')
      return
    }

    setBusy(true)
    try {
      await completeCustomerSignupDetails(businessId, {
        businessName: form.businessName,
        websiteUrl: form.websiteUrl,
        termsAccepted: true,
        businessCountry: form.businessCountry,
        accountCurrencyCode: form.accountCurrencyCode,
        accountTimeZone: form.accountTimeZone,
        whatYouSell,
        whoBuysToday,
        whereTheyServe,
        howBuyersContact,
        orderValueHint,
      })
      notifyOnboardingStorageChanged()
      navigate('/', { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        const field = err.body && typeof err.body === 'object' && 'field' in err.body
          ? (err.body as { field?: string }).field
          : undefined
        if (field === 'websiteUrl' || err.message === 'please enter valid website details') {
          setWebsiteFieldError('please enter valid website details')
          setError(null)
        } else {
          setError(err.message)
        }
      } else {
        setError('Something went wrong. Try again.')
      }
    } finally {
      setBusy(false)
    }
  }

  if (contextLoading) {
    return (
      <PageLayout title="Your business">
        <InlineLoading />
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="Your business"
      lead="Tell us about your business so we can prepare for your setup call."
    >
      <form className="form" onSubmit={(e) => void onSubmit(e)}>
        <ErrorAlert message={error} />
        <div className="field">
          <label htmlFor="businessName">Business name</label>
          <input
            id="businessName"
            name="businessName"
            type="text"
            autoComplete="organization"
            required
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="websiteUrl">Website</label>
          <input
            id="websiteUrl"
            name="websiteUrl"
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            required
            maxLength={MAX_URL_LENGTH}
            value={websiteUrl}
            onChange={(e) => {
              setWebsiteUrl(e.target.value)
              setWebsiteFieldError(null)
            }}
            aria-invalid={websiteFieldError ? true : undefined}
          />
          {websiteFieldError ? (
            <p role="alert" style={{ color: 'var(--color-danger)', margin: '0.35rem 0 0' }}>
              {websiteFieldError}
            </p>
          ) : null}
        </div>
        <div className="field">
          <label htmlFor="businessCountry">Business country (optional)</label>
          <select
            id="businessCountry"
            name="businessCountry"
            value={businessCountry}
            onChange={(e) => setBusinessCountry(e.target.value)}
          >
            <option value="">Select country</option>
            {countryOptions.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="accountCurrencyCode">Account currency (optional)</label>
          <select
            id="accountCurrencyCode"
            name="accountCurrencyCode"
            value={accountCurrencyCode}
            onChange={(e) => setAccountCurrencyCode(e.target.value as SignupAccountCurrency)}
          >
            {SIGNUP_ACCOUNT_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {currencyLabel(code)}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="accountTimeZone">Time zone (optional)</label>
          <select
            id="accountTimeZone"
            name="accountTimeZone"
            value={accountTimeZone}
            onChange={(e) => setAccountTimeZone(e.target.value)}
          >
            <option value="">Select time zone</option>
            {timeZoneOptions.map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="whatYouSell">What you sell (optional)</label>
          <input
            id="whatYouSell"
            name="whatYouSell"
            type="text"
            value={whatYouSell}
            onChange={(e) => setWhatYouSell(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="whoBuysToday">Who buys from you today (optional)</label>
          <input
            id="whoBuysToday"
            name="whoBuysToday"
            type="text"
            value={whoBuysToday}
            onChange={(e) => setWhoBuysToday(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="whereTheyServe">Where you serve customers (optional)</label>
          <input
            id="whereTheyServe"
            name="whereTheyServe"
            type="text"
            value={whereTheyServe}
            onChange={(e) => setWhereTheyServe(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="howBuyersContact">How buyers get in touch (optional)</label>
          <input
            id="howBuyersContact"
            name="howBuyersContact"
            type="text"
            value={howBuyersContact}
            onChange={(e) => setHowBuyersContact(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="orderValueHint">Typical order value (optional)</label>
          <input
            id="orderValueHint"
            name="orderValueHint"
            type="text"
            value={orderValueHint}
            onChange={(e) => setOrderValueHint(e.target.value)}
          />
        </div>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={termsAccepted}
              onChange={(e) => setTermsAccepted(e.target.checked)}
            />
            {' '}
            I accept the{' '}
            <span className="link-like" style={{ textDecoration: 'underline' }}>
              terms and conditions
            </span>
          </label>
        </div>
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <InlineLoading label="Saving…" /> : 'Continue'}
          </button>
        </div>
      </form>
    </PageLayout>
  )
}
