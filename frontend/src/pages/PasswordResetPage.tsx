import { type FormEvent, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { authPasswordResetConfirm } from '../api/auth'
import { ApiError } from '../api/client'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import {
  MAX_EMAIL_LENGTH,
  PASSWORD_MAX_LENGTH,
  validatePasswordField,
  validateRegisterForm,
} from '../utils/validation'

export function PasswordResetPage(): ReactElement {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const tokenFromQuery = searchParams.get('token') ?? ''
  const emailFromQuery = searchParams.get('email') ?? ''

  const initialEmail = useMemo(() => emailFromQuery.trim().toLowerCase(), [emailFromQuery])

  const [email, setEmail] = useState(initialEmail)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const missingLinkParams = tokenFromQuery.length === 0 || initialEmail.length === 0

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)

    if (missingLinkParams) {
      setError('This reset link is incomplete. Request a new password reset.')
      return
    }

    const emailForm = validateRegisterForm(email, '')
    if (!emailForm.ok) {
      setError(emailForm.message)
      return
    }

    const pwForm = validatePasswordField(password)
    if (!pwForm.ok) {
      setError(pwForm.message)
      return
    }

    if (confirmPassword.trim() !== pwForm.password) {
      setError('Passwords must match.')
      return
    }

    setBusy(true)
    try {
      const res = await authPasswordResetConfirm({
        email: emailForm.email,
        token: tokenFromQuery,
        password: pwForm.password,
      })
      navigate('/login', {
        replace: true,
        state: { resetMessage: res.message },
      })
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageLayout
      title="Choose a new password"
      lead="Set a new password for your account."
    >
      {missingLinkParams ? (
        <div className="form">
          <ErrorAlert message="This reset link is incomplete or expired. Request a new one." />
          <div className="actions">
            <Link className="btn btn-primary" to="/password-reset/request">
              Request reset link
            </Link>
            <Link className="btn btn-secondary" to="/login">
              Back to log in
            </Link>
          </div>
        </div>
      ) : (
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
              readOnly
              maxLength={MAX_EMAIL_LENGTH}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="password">New password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              maxLength={PASSWORD_MAX_LENGTH}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="confirmPassword">Confirm new password</label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              maxLength={PASSWORD_MAX_LENGTH}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <div className="actions">
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? <InlineLoading label="Updating…" /> : 'Update password'}
            </button>
            <Link className="btn btn-secondary" to="/login">
              Back to log in
            </Link>
          </div>
        </form>
      )}
    </PageLayout>
  )
}
