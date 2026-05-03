import { type FormEvent, useState } from 'react'
import type { ReactElement } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import { useAuth } from '../hooks/useAuth'
import {
  MAX_EMAIL_LENGTH,
  PASSWORD_MAX_LENGTH,
  validateLoginForm,
} from '../utils/validation'

export function LoginPage(): ReactElement {
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'
  const { login } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)

    const parsed = validateLoginForm(email, password)
    if (!parsed.ok) {
      setError(parsed.message)
      return
    }

    setBusy(true)
    try {
      await login(parsed.email, parsed.password)
      navigate(from, { replace: true })
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageLayout
      title="Log in"
      lead="Use the email and password you registered with."
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
            autoComplete="current-password"
            required
            maxLength={PASSWORD_MAX_LENGTH}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <InlineLoading label="Signing in…" /> : 'Log in'}
          </button>
          <Link className="btn btn-secondary" to="/register">
            Create an account
          </Link>
        </div>
      </form>
    </PageLayout>
  )
}
