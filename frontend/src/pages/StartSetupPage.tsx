import { type FormEvent, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { startSetupRun } from '../api/setupRuns'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import { useOnboardingState } from '../hooks/useOnboardingState'

interface Temporal503Body {
  setupRunId?: string
  detail?: string
}

function extractSetupRunId(body: unknown): string | undefined {
  if (
    typeof body === 'object' &&
    body !== null &&
    'setupRunId' in body &&
    typeof (body as Temporal503Body).setupRunId === 'string'
  ) {
    return (body as Temporal503Body).setupRunId
  }
  return undefined
}

export function StartSetupPage(): ReactElement {
  const navigate = useNavigate()
  const { snapshot, setSetupRunId } = useOnboardingState()
  const { userId, businessId } = snapshot
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) navigate('/register', { replace: true })
    else if (!businessId) navigate('/onboarding/business', { replace: true })
  }, [userId, businessId, navigate])

  async function onSubmit(e?: FormEvent): Promise<void> {
    e?.preventDefault()
    if (!businessId) return
    setError(null)
    setBusy(true)
    try {
      const res = await startSetupRun(businessId)
      setSetupRunId(res.setupRunId)
      navigate(`/setup/progress/${res.setupRunId}`, { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'temporal_unavailable' && err.status === 503) {
          const fallbackId = extractSetupRunId(err.body) ?? snapshot.setupRunId ?? undefined
          if (fallbackId) {
            setSetupRunId(fallbackId)
            navigate(`/setup/progress/${fallbackId}`, { replace: true })
          } else {
            setError('Temporal unavailable but no setupRunId was returned.')
          }
        } else {
          setError(err.message)
        }
      } else {
        setError('Could not start setup.')
      }
    } finally {
      setBusy(false)
    }
  }

  if (!userId || !businessId) {
    return (
      <PageLayout title="Setup">
        <InlineLoading />
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="Start setup run"
      lead="Begins the Temporal workflow for this confirmed business context. Requires worker + Temporal up."
    >
      <form className="form" onSubmit={(e) => void onSubmit(e)}>
        <ErrorAlert message={error} />
        <p style={{ margin: '0', fontSize: '0.9rem', color: 'var(--color-muted)' }}>
          Business ID:{' '}
          <code style={{ wordBreak: 'break-all', fontSize: '0.8rem' }}>{businessId}</code>
        </p>
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? <InlineLoading label="Starting…" /> : 'Start setup'}
          </button>
        </div>
      </form>
    </PageLayout>
  )
}
