import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'

import { Link } from 'react-router-dom'

import {
  adminGetSetupRunReport,
  adminListBusinesses,
  adminListSetupRuns,
  adminListUsers,
  type AdminBusinessDto,
  type AdminSetupRunDto,
  type AdminUserDto,
} from '../../api/admin'

import { ApiError } from '../../api/client'

import type { SetupRunReportResponse } from '../../types/api'

import { ErrorAlert } from '../../components/feedback/ErrorAlert'

import { InlineLoading } from '../../components/feedback/InlineLoading'

import { PageLayout } from '../../components/layout/PageLayout'

const HIDDEN_BY_DEFAULT = new Set(['signup_not_finished', 'finished'])

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ')
}

export function AdminConsolePage(): ReactElement {
  const [users, setUsers] = useState<AdminUserDto[]>([])

  const [businesses, setBusinesses] = useState<AdminBusinessDto[]>([])

  const [setupRuns, setSetupRuns] = useState<AdminSetupRunDto[]>([])

  const [selectedRunId, setSelectedRunId] = useState('')

  const [report, setReport] = useState<SetupRunReportResponse['report'] | null>(null)

  const [loading, setLoading] = useState(true)

  const [reportLoading, setReportLoading] = useState(false)

  const [error, setError] = useState<string | null>(null)

  const [showHiddenStatuses, setShowHiddenStatuses] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)

    setError(null)

    try {
      const [userRes, businessRes, runRes] = await Promise.all([
        adminListUsers(),

        adminListBusinesses(),

        adminListSetupRuns(),
      ])

      setUsers(userRes.users)

      setBusinesses(businessRes.businesses)

      setSetupRuns(runRes.setupRuns)
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

  async function loadReport(setupRunId: string): Promise<void> {
    setSelectedRunId(setupRunId)

    setReportLoading(true)

    setError(null)

    try {
      const res = await adminGetSetupRunReport(setupRunId)

      setReport(res.report)
    } catch (err) {
      setReport(null)

      if (err instanceof ApiError) setError(err.message)

      else setError('Could not load setup report.')
    } finally {
      setReportLoading(false)
    }
  }

  return (
    <PageLayout title="Admin console" lead="Operator working list.">
      <ErrorAlert message={error} />

      {loading ? (
        <InlineLoading label="Loading admin data…" />
      ) : (
        <>
          <section>
            <h2>Users ({users.length})</h2>

            <ul>
              {users.slice(0, 20).map((user) => (
                <li key={user.id}>
                  {user.email}

                  {user.platformAdmin ? ' · platform admin' : ''}
                </li>
              ))}
            </ul>
          </section>

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
                  {bc.businessName ?? bc.businessId} · {bc.customerEmail ?? 'no email'} · user{' '}
                  {bc.userId} · {formatStatus(bc.operatorListStatus)}
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

          <section>
            <h2>Setup runs ({setupRuns.length})</h2>

            <ul>
              {setupRuns.slice(0, 20).map((run) => (
                <li key={run.setupRunId}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => void loadReport(run.setupRunId)}
                  >
                    View report
                  </button>

                  {run.setupRunId} · {run.status} · business {run.businessId}
                </li>
              ))}
            </ul>
          </section>

          {selectedRunId ? (
            <section>
              <h2>Report for {selectedRunId}</h2>

              {reportLoading ? <InlineLoading label="Loading report…" /> : null}

              {report ? (
                <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(report, null, 2)}</pre>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </PageLayout>
  )
}
