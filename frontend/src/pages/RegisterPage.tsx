import { type FormEvent, useState } from 'react'
import type { ReactElement } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import { useAuth } from '../hooks/useAuth'
import { useOnboardingState } from '../hooks/useOnboardingState'
import {
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  MAX_URL_LENGTH,
  PASSWORD_MAX_LENGTH,
  validateRegisterWithPasswordForm,
} from '../utils/validation'

export function RegisterPage(): ReactElement {
  const navigate = useNavigate()
  const { register } = useAuth()
  const { setBusinessId } = useOnboardingState()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [websiteUrl, setWebsiteUrl] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    const form = validateRegisterWithPasswordForm(
      email,
      name,
      phone,
      websiteUrl,
      password,
      confirmPassword,
    )
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
        ...(form.name !== undefined ? { name: form.name } : {}),
        ...(form.websiteUrl !== undefined ? { websiteUrl: form.websiteUrl } : {}),
      })
      if (user.primaryBusinessId) {
        setBusinessId(user.primaryBusinessId)
      }
      navigate('/onboarding/accounts', { replace: true })
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
      lead="We'll use your phone to reach you. Website is optional — if you share it, we'll start learning about your business right away."
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
          <label htmlFor="websiteUrl">Website (optional)</label>
          <input
            id="websiteUrl"
            name="websiteUrl"
            type="url"
            placeholder="https://example.com"
            maxLength={MAX_URL_LENGTH}
            value={websiteUrl}
            onChange={(e) => setWebsiteUrl(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="name">Name (optional)</label>
          <input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            maxLength={MAX_NAME_LENGTH}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
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
