import type { ReactElement } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { PageLayout } from '../components/layout/PageLayout'

export function IntakeThankYouPage(): ReactElement {
  const navigate = useNavigate()

  return (
    <PageLayout
      title="Thank you"
      lead="You're all set for now."
    >
      <p style={{ margin: '0 0 1rem', color: 'var(--color-muted)' }}>
        Your part is done. An expert will complete your setup and call you when your Google Ads
        account is ready.
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
