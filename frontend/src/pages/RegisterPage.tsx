import { type FormEvent, useState } from 'react'
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { createUser } from '../api/users'
import { ApiError } from '../api/client'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import { useOnboardingState } from '../hooks/useOnboardingState'
import {
  MAX_EMAIL_LENGTH,
  MAX_NAME_LENGTH,
  validateRegisterForm,
} from '../utils/validation'

export function RegisterPage(): ReactElement {
  const navigate = useNavigate()
  const { setUserId } = useOnboardingState()
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    const form = validateRegisterForm(email, name)
    if (!form.ok) {
      setError(form.message)
      return
    }
    setBusy(true)
    try {
      const { user } = await createUser(form.email, form.name)
      setUserId(user.id)
      navigate('/onboarding/business', { replace: true })
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
      lead="Enter your email to register. In production this becomes full auth."
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
        </div>
      </form>
    </PageLayout>
  )
}
