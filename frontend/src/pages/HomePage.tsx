import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { PageLayout } from '../components/layout/PageLayout'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { useAuth } from '../hooks/useAuth'
import { useOnboardingState } from '../hooks/useOnboardingState'

export function HomePage(): ReactElement {
  const { user, loading, logout } = useAuth()
  const { snapshot } = useOnboardingState()

  if (loading) {
    return (
      <PageLayout title="Welcome">
        <InlineLoading />
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="Welcome"
      lead="Orchestrate onboarding and setup with the Zuggernaut MVP flow."
    >
      <div className="actions" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
        {!user ? (
          <>
            <Link className="btn btn-primary" to="/register">
              Start — register
            </Link>
            <Link className="btn btn-secondary" to="/login">
              Log in
            </Link>
          </>
        ) : (
          <>
            <p
              style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', color: 'var(--color-muted)' }}
            >
              Signed in as <strong>{user.email}</strong>. Continue onboarding:
            </p>
            <Link className="btn btn-primary" to="/onboarding/business">
              Continue onboarding
            </Link>
            {snapshot.setupRunId ? (
              <Link className="btn btn-secondary" to={`/setup/progress/${snapshot.setupRunId}`}>
                Open last setup progress
              </Link>
            ) : null}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                void (async () => {
                  await logout()
                  window.location.assign('/login')
                })()
              }}
            >
              Sign out
            </button>
          </>
        )}
      </div>
    </PageLayout>
  )
}
