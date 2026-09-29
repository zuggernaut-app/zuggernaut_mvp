import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { PageLayout } from '../components/layout/PageLayout'

export function IntakeThankYouPage(): ReactElement {
  return (
    <PageLayout
      title="Thank you"
      lead="We'll take it from here."
    >
      <p style={{ margin: '0 0 1rem', color: 'var(--color-muted)' }}>
        Your details are saved. Our team will review your business and set up your Google Ads
        campaign.
      </p>
      <div className="actions">
        <Link className="btn btn-secondary" to="/">
          Back to home
        </Link>
      </div>
    </PageLayout>
  )
}
