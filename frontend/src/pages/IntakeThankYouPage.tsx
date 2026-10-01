import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { PageLayout } from '../components/layout/PageLayout'

export function IntakeThankYouPage(): ReactElement {
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
        <Link className="btn btn-secondary" to="/">
          Back to home
        </Link>
      </div>
    </PageLayout>
  )
}
