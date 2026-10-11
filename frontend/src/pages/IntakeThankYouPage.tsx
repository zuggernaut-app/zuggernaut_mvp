import type { ReactElement } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PageLayout } from '../components/layout/PageLayout'

export function IntakeThankYouPage(): ReactElement {
  const navigate = useNavigate()

  return (
    <PageLayout
      title="Thank you"
      lead="We'll call you to take this forward. You can also continue setup yourself."
    >
      <p style={{ margin: '0 0 1rem', color: 'var(--color-muted)' }}>
        An expert will call you to help finish setup. You can keep going on your own anytime using
        business setup below.
      </p>
      <div className="actions">
        <Link className="btn btn-primary" to="/business-setup">
          Continue to business setup
        </Link>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() =>
            navigate('/onboarding/accounts', { replace: true, state: { editMode: true } })
          }
        >
          Edit intake
        </button>
        <Link className="btn btn-secondary" to="/">
          Back to home
        </Link>
      </div>
    </PageLayout>
  )
}
