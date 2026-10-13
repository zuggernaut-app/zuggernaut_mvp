import { type FormEvent, useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import { useAuth } from '../hooks/useAuth'
import { useOnboardingState } from '../hooks/useOnboardingState'
import {
  SIGNUP_ACCOUNT_CURRENCIES,
  browserTimeZoneId,
  currencyLabel,
  listCountryOptions,
  listTimeZoneOptions,
  preselectedCurrencyForCountry,
  type SignupAccountCurrency,
} from '../lib/signupAccount'
import {
  MAX_EMAIL_LENGTH,
  MAX_URL_LENGTH,
  PASSWORD_MAX_LENGTH,
  validateSignupRegisterForm,
} from '../utils/validation'

export function RegisterPage(): ReactElement {
  const navigate = useNavigate()
  const { register } = useAuth()
  const { setBusinessId } = useOnboardingState()
  const countryOptions = useMemo(() => listCountryOptions(), [])
  const timeZoneOptions = useMemo(() => listTimeZoneOptions(), [])
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [businessCountry, setBusinessCountry] = useState('US')
  const [accountCurrencyCode, setAccountCurrencyCode] = useState<SignupAccountCurrency>('USD')
  const [accountTimeZone, setAccountTimeZone] = useState(() => browserTimeZoneId())
  const [websiteAccessibleDuringCall, setWebsiteAccessibleDuringCall] = useState<'yes' | 'no' | ''>(
    '',
  )
  const [managedAdsAccountConsent, setManagedAdsAccountConsent] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setAccountCurrencyCode(preselectedCurrencyForCountry(businessCountry))
  }, [businessCountry])

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    const form = validateSignupRegisterForm({
      email,
      phone,
      websiteUrl,
      password,
      confirmPassword,
      businessName,
      businessCountry,
      accountCurrencyCode,
      accountTimeZone,
      websiteAccessibleDuringCall,
      managedAdsAccountConsent,
    })
    if (!form.ok) {
      setError(form.message)
      return
    }
    setBusy(true)
    try {
      const user = await register({
        email: form.email,
        password: form.password,
        phone: form.phone,
        businessName: form.businessName,
        businessCountry: form.businessCountry,
        accountCurrencyCode: form.accountCurrencyCode,
        accountTimeZone: form.accountTimeZone,
        websiteAccessibleDuringCall: form.websiteAccessibleDuringCall,
        managedAdsAccountConsent: form.managedAdsAccountConsent,
        ...(form.websiteUrl !== undefined ? { websiteUrl: form.websiteUrl } : {}),
      })
      if (user.primaryBusinessId) {
        setBusinessId(user.primaryBusinessId)
      }
      navigate('/', { replace: true })
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageLayout
      title="Create your account"
      lead="Tell us about your business. We'll call you to confirm details before we create your Google Ads account."
    >
      <form className="form" onSubmit={(e) => void onSubmit(e)}>
        <ErrorAlert message={error} />
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            maxLength={MAX_EMAIL_LENGTH}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            maxLength={PASSWORD_MAX_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="confirmPassword">Confirm password</label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={10}
            maxLength={PASSWORD_MAX_LENGTH}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="phone">Phone</label>
          <input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
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
          <label htmlFor="websiteUrl">Website (optional)</label>
          <input
            id="websiteUrl"
            name="websiteUrl"
            type="text"
            inputMode="url"
            autoComplete="url"
            spellCheck={false}
            placeholder="www.yoursite.com"
            maxLength={MAX_URL_LENGTH}
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="businessCountry">Business country</label>
          <select
            id="businessCountry"
            name="businessCountry"
            required
            value={businessCountry}
            onChange={(e) => setBusinessCountry(e.target.value)}
          >
            {countryOptions.map((opt) => (
              <option key={opt.code} value={opt.code}>
                {opt.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="accountCurrencyCode">Account currency</label>
          <select
            id="accountCurrencyCode"
            name="accountCurrencyCode"
            required
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
          <label htmlFor="accountTimeZone">Account time zone</label>
          <input
            id="accountTimeZone"
            name="accountTimeZone"
            list="signup-timezone-list"
            required
            value={accountTimeZone}
            onChange={(e) => setAccountTimeZone(e.target.value)}
            placeholder="Search time zones…"
            autoComplete="off"
          />
          <datalist id="signup-timezone-list">
            {timeZoneOptions.map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
        </div>
        <fieldset className="field">
          <legend>Can someone open your website during our call?</legend>
          <label style={{ display: 'block', marginBottom: '0.35rem' }}>
            <input
              type="radio"
              name="websiteAccessibleDuringCall"
              value="yes"
              checked={websiteAccessibleDuringCall === 'yes'}
              onChange={() => setWebsiteAccessibleDuringCall('yes')}
            />
            {' '}
            Yes
          </label>
          <label style={{ display: 'block' }}>
            <input
              type="radio"
              name="websiteAccessibleDuringCall"
              value="no"
              checked={websiteAccessibleDuringCall === 'no'}
              onChange={() => setWebsiteAccessibleDuringCall('no')}
            />
            {' '}
            No
          </label>
        </fieldset>
        <div className="field">
          <label>
            <input
              type="checkbox"
              checked={managedAdsAccountConsent}
              onChange={(e) => setManagedAdsAccountConsent(e.target.checked)}
            />
            {' '}
            I agree that Zuggernaut will create a Google Ads account under its manager account and
            manage it for my business.
          </label>
        </div>
        <section className="card" hidden aria-hidden="true">
          <p>Payment method (not required at signup)</p>
        </section>
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <InlineLoading label="Saving…" /> : 'Continue'}
          </button>
          <Link className="btn btn-secondary" to="/login">
            Already have an account?
          </Link>
        </div>
      </form>
    </PageLayout>
  )
}
