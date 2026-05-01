import { useEffect } from 'react'
import type { ReactElement } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import { useSetupRunStatus } from '../hooks/useSetupRunStatus'
import { useOnboardingState } from '../hooks/useOnboardingState'

function statusTone(status: string): string {
  if (status === 'RUNNING') return 'status-running'
  if (status === 'FAILED') return 'status-failed'
  if (status === 'SUCCEEDED') return 'status-succeeded'
  return ''
}

export function SetupProgressPage(): ReactElement {
  const { setupRunId: paramId } = useParams<{ setupRunId: string }>()
  const navigate = useNavigate()
  const { snapshot, setSetupRunId } = useOnboardingState()
  const effectiveId = paramId ?? snapshot.setupRunId

  useEffect(() => {
    if (paramId && paramId !== snapshot.setupRunId) setSetupRunId(paramId)
  }, [paramId, snapshot.setupRunId, setSetupRunId])

  useEffect(() => {
    if (!snapshot.userId) navigate('/register', { replace: true })
  }, [snapshot.userId, navigate])

  const { data, loading, error, lastUpdatedAt, appearsStuck, pollingPaused, refetch } =
    useSetupRunStatus(effectiveId ?? null)

  if (!snapshot.userId) {
    return (
      <PageLayout title="Setup progress">
        <InlineLoading />
      </PageLayout>
    )
  }

  if (!effectiveId) {
    return (
      <PageLayout title="Setup progress" lead="No setup run selected.">
        <ErrorAlert message="Missing setupRunId." />
        <Link className="btn btn-primary" to="/setup">
          Go to setup
        </Link>
      </PageLayout>
    )
  }

  const run = data?.setupRun

  return (
    <PageLayout
      title="Setup progress"
      lead="Polling the API while the Temporal worker advances steps."
    >
      <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '1rem' }}>
        Run <code style={{ wordBreak: 'break-all', fontSize: '0.8rem' }}>{effectiveId}</code>
      </p>
      <ErrorAlert message={error} />
      {loading && !data ? <InlineLoading /> : null}

      {run ? (
        <>
          <section style={{ marginTop: '0.75rem' }}>
            <span className={`statusPill ${statusTone(run.status)}`}>{run.status}</span>
            {pollingPaused ? (
              <span
                style={{
                  marginLeft: '0.5rem',
                  fontSize: '0.8rem',
                  color: 'var(--color-muted)',
                }}
              >
                Polling paused (workflow not RUNNING).
              </span>
            ) : null}
          </section>
          {run.lastErrorSummary ? (
            <div className="alert alert-error" style={{ marginTop: '1rem' }}>
              {run.lastErrorSummary}
            </div>
          ) : null}
          {appearsStuck ? (
            <div className="alert alert-info" style={{ marginTop: '1rem' }}>
              <strong>Looks stuck?</strong> After ~{Math.round((5 * 60) / 60)} minutes in
              RUNNING: verify the Temporal worker logs, ensure <code>MONGODB_URI</code>
              matches, and inspect the workflow id {run.temporalWorkflowId ?? '(none)'} in
              Temporal UI or CLI.
              <div style={{ marginTop: '0.5rem' }}>
                Or try{' '}
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void refetch()}
                >
                  refresh now
                </button>
              </div>
            </div>
          ) : null}
          {typeof lastUpdatedAt === 'number' ? (
            <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '1rem' }}>
              Last polled: {new Date(lastUpdatedAt).toLocaleTimeString()}
            </p>
          ) : null}
          <ul className="stepsList">
            {(data?.steps ?? []).length === 0 ? (
              <li>No step rows yet.</li>
            ) : (
              (data?.steps ?? []).map((step) => (
                <li key={step.id}>
                  <strong>{step.stepName}</strong> · {step.status}
                  {step.lastErrorSummary ? (
                    <div
                      style={{
                        color: 'var(--color-danger)',
                        marginTop: '0.35rem',
                        fontSize: '0.85rem',
                      }}
                    >
                      {step.lastErrorSummary}
                    </div>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </>
      ) : null}

      <div className="actions" style={{ marginTop: '2rem' }}>
        <button type="button" className="btn btn-secondary" onClick={() => void refetch()}>
          Refresh
        </button>
        <Link className="btn btn-secondary" to="/">
          Home
        </Link>
      </div>
    </PageLayout>
  )
}
