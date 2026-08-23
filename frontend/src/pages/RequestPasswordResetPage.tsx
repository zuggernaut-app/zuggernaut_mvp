import { type FormEvent, useState } from 'react'
import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { authPasswordResetRequest } from '../api/auth'
import { ApiError } from '../api/client'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import { MAX_EMAIL_LENGTH, validateRegisterForm } from '../utils/validation'

export function RequestPasswordResetPage(): ReactElement {
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setSuccess(null)

    const parsed = validateRegisterForm(email, '')
    if (!parsed.ok) {
      setError(parsed.message)
      return
    }

    setBusy(true)
    try {
      const res = await authPasswordResetRequest({ email: parsed.email })
      setSuccess(res.message)
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <PageLayout
      title="Reset password"
      lead="Enter your account email. If we recognize it, we will send a reset link."
    >
      <form className="form" onSubmit={(e) => void onSubmit(e)}>
        <ErrorAlert message={error} />
        {success ? (
          <p className="notice" role="status">{success}</p>
        ) : null}
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
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy || success !== null}>
            {busy ? <InlineLoading label="Sending…" /> : 'Send reset link'}
          </button>
          <Link className="btn btn-secondary" to="/login">
            Back to log in
          </Link>
        </div>
      </form>
    </PageLayout>
  )
}
