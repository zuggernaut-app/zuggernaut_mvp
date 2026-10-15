import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'

import { Link } from 'react-router-dom'

import { adminListBusinesses, type AdminBusinessDto } from '../../api/admin'

import { ApiError } from '../../api/client'

import { formatOperatorStatus } from '../../lib/operatorCallProgress'

import { ErrorAlert } from '../../components/feedback/ErrorAlert'

import { InlineLoading } from '../../components/feedback/InlineLoading'

import { PageLayout } from '../../components/layout/PageLayout'

const HIDDEN_BY_DEFAULT = new Set(['signup_not_finished', 'finished'])

export function AdminConsolePage(): ReactElement {
  const [businesses, setBusinesses] = useState<AdminBusinessDto[]>([])

  const [loading, setLoading] = useState(true)

  const [error, setError] = useState<string | null>(null)

  const [showHiddenStatuses, setShowHiddenStatuses] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)

    setError(null)

    try {
      const businessRes = await adminListBusinesses()

      setBusinesses(businessRes.businesses)
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)

      else setError('Could not load admin data.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const visibleBusinesses = useMemo(() => {
    if (showHiddenStatuses) return businesses
    return businesses.filter((bc) => !HIDDEN_BY_DEFAULT.has(bc.operatorListStatus))
  }, [businesses, showHiddenStatuses])

  return (
    <PageLayout title="Admin console" lead="Operator working list.">
      <ErrorAlert message={error} />

      {loading ? (
        <InlineLoading label="Loading admin data…" />
      ) : (
        <section>
          <h2>Businesses ({visibleBusinesses.length} shown)</h2>
          <label style={{ display: 'block', marginBottom: '0.5rem' }}>
            <input
              type="checkbox"
              checked={showHiddenStatuses}
              onChange={(e) => setShowHiddenStatuses(e.target.checked)}
            />
            Show signup not finished and finished
          </label>

          <ul>
            {visibleBusinesses.map((bc) => (
              <li key={bc.businessId} style={{ marginBottom: '0.5rem' }}>
                {bc.businessName ?? bc.businessId} · {bc.customerEmail ?? 'no email'} ·{' '}
                {formatOperatorStatus(bc.operatorListStatus)}
                <div className="actions" style={{ marginTop: '0.35rem' }}>
                  <Link
                    className="btn btn-primary"
                    to={`/admin/businesses/${bc.businessId}/operator`}
                  >
                    Open
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PageLayout>
  )
}
