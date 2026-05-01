import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { PageLayout } from '../components/layout/PageLayout'
import { useOnboardingState } from '../hooks/useOnboardingState'
import { resetLocalSession } from '../utils/storage'

export function HomePage(): ReactElement {
  const { snapshot } = useOnboardingState()

  return (
    <PageLayout
      title="Welcome"
      lead="Orchestrate onboarding and setup with the Zuggernaut MVP flow."
    >
      <div className="actions" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
        {!snapshot.userId ? (
          <Link className="btn btn-primary" to="/register">
            Start — register
          </Link>
        ) : (
          <>
            <p
              style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', color: 'var(--color-muted)' }}
            >
              Dev user loaded (x-dev-user-id). Continue where you left off:
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
                resetLocalSession()
                window.location.assign('/register')
              }}
            >
              Use a different email
            </button>
          </>
        )}
      </div>
    </PageLayout>
  )
}
