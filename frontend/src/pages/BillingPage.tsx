import { useCallback, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'
import {
  billingCheckout,
  billingPortal,
  billingStatus,
  type BillingSubscriptionDto,
} from '../api/billing'
import { ApiError } from '../api/client'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'

export function BillingPage(): ReactElement {
  const [subscription, setSubscription] = useState<BillingSubscriptionDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await billingStatus()
      setSubscription(res.subscription)
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not load billing status.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function onCheckout(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await billingCheckout('starter')
      window.location.assign(res.checkoutUrl)
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Checkout could not be started.')
      setBusy(false)
    }
  }

  async function onPortal(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await billingPortal()
      window.location.assign(res.portalUrl)
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Billing portal could not be opened.')
      setBusy(false)
    }
  }

  return (
    <PageLayout
      title="Billing"
      lead="Manage your Zuggernaut subscription. Setup and campaign enable require an active plan."
    >
      <ErrorAlert message={error} />
      {loading ? (
        <InlineLoading label="Loading billing…" />
      ) : (
        <div className="actions" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          {subscription ? (
            <p style={{ margin: 0 }}>
              Status: <strong>{subscription.status}</strong>
              {subscription.plan ? ` · ${subscription.plan.name}` : ''}
              {subscription.currentPeriodEnd
                ? ` · renews ${new Date(subscription.currentPeriodEnd).toLocaleDateString()}`
                : ''}
            </p>
          ) : (
            <p style={{ margin: 0 }}>No subscription yet.</p>
          )}
          {!subscription ? (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void onCheckout()}
            >
              {busy ? <InlineLoading label="Starting checkout…" /> : 'Subscribe'}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void onPortal()}
            >
              {busy ? <InlineLoading label="Opening portal…" /> : 'Manage billing'}
            </button>
          )}
          <Link className="btn btn-secondary" to="/">
            Back to home
          </Link>
        </div>
      )}
    </PageLayout>
  )
}
