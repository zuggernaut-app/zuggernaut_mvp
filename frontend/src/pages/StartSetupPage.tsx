import { useEffect, useState, type FormEvent } from 'react'
import type { ReactElement } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { startSetupRun } from '../api/setupRuns'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import {
  INTEGRATION_PROVIDERS,
  useIntegrationConnections,
} from '../hooks/useIntegrationConnections'
import { requiredProvidersReadyForSetup } from '../lib/provisioningUi'
import { useOnboardingState } from '../hooks/useOnboardingState'

interface Temporal503Body {
  setupRunId?: string
  detail?: string
}

function extractSetupRunId(body: unknown): string | undefined {
  if (
    typeof body === 'object' &&
    body !== null &&
    'setupRunId' in body &&
    typeof (body as Temporal503Body).setupRunId === 'string'
  ) {
    return (body as Temporal503Body).setupRunId
  }
  return undefined
}

export function StartSetupPage(): ReactElement {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { snapshot, setSetupRunId } = useOnboardingState()
  const { businessId } = snapshot
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [integrationNotice, setIntegrationNotice] = useState<string | null>(null)

  const {
    connections,
    loading: connectionsLoading,
    error: connectionsError,
    refetch: refetchConnections,
    connectProvider,
    providerLabels,
    statusLabel,
  } = useIntegrationConnections(businessId)

  useEffect(() => {
    if (!businessId) navigate('/onboarding/business', { replace: true })
  }, [businessId, navigate])

  useEffect(() => {
    const integration = searchParams.get('integration')
    const provider = searchParams.get('provider')
    const reason = searchParams.get('reason')
    if (!integration) return

    if (integration === 'connected' && provider) {
      setIntegrationNotice(`${provider} connected successfully.`)
      void refetchConnections()
    } else if (integration === 'error') {
      setIntegrationNotice(
        reason ? `Google connection failed (${reason}).` : 'Google connection failed.',
      )
    }

    const next = new URLSearchParams(searchParams)
    next.delete('integration')
    next.delete('provider')
    next.delete('reason')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, refetchConnections])

  async function onSubmit(e?: FormEvent): Promise<void> {
    e?.preventDefault()
    if (!businessId) return
    setError(null)
    setBusy(true)
    try {
      const res = await startSetupRun(businessId)
      setSetupRunId(res.setupRunId)
      navigate(`/setup/progress/${res.setupRunId}`, { replace: true })
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.code === 'temporal_unavailable' && err.status === 503) {
          const fallbackId = extractSetupRunId(err.body) ?? snapshot.setupRunId ?? undefined
          if (fallbackId) {
            setSetupRunId(fallbackId)
            navigate(`/setup/progress/${fallbackId}`, { replace: true })
          } else {
            setError('Temporal unavailable but no setupRunId was returned.')
          }
        } else {
          setError(err.message)
        }
      } else {
        setError('Could not start setup.')
      }
    } finally {
      setBusy(false)
    }
  }

  if (!businessId) {
    return (
      <PageLayout title="Setup">
        <InlineLoading />
      </PageLayout>
    )
  }

  const gtmReady = connections.gtm?.ready === true
  const adsReady = connections.google_ads?.ready === true
  const canStartSetup = requiredProvidersReadyForSetup(connections)
  const needsProvisioningApproval =
    !canStartSetup &&
    ((connections.gtm?.reason === 'provisioning_required' && !gtmReady) ||
      (connections.google_ads?.reason === 'provisioning_required' && !adsReady))

  return (
    <PageLayout
      title="Start setup run"
      lead="Connect required Google integrations, then begin the Temporal workflow for this business."
    >
      <form className="form" onSubmit={(e) => void onSubmit(e)}>
        <ErrorAlert message={error ?? connectionsError} />
        {integrationNotice ? (
          <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
            {integrationNotice}
          </div>
        ) : null}

        <section style={{ marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Google integrations</h2>
          {connectionsLoading && !connections.gtm ? <InlineLoading label="Loading connections…" /> : null}
          <ul className="stepsList">
            {INTEGRATION_PROVIDERS.map((provider) => {
              const status = connections[provider]
              const ready = status?.ready === true
              return (
                <li key={provider}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                    <strong>{providerLabels[provider]}</strong>
                    <span className={`statusPill ${ready ? 'status-succeeded' : 'status-review'}`}>
                      {status ? statusLabel(status) : 'Loading…'}
                    </span>
                    {!ready ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void connectProvider(provider)}
                      >
                        Connect Google
                      </button>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ul>
          {!canStartSetup ? (
            <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginTop: '0.75rem' }}>
              {needsProvisioningApproval
                ? 'GTM and Google Ads must be OAuth-connected before setup can start. If provisioning approval is needed, start setup and approve on the progress screen.'
                : 'GTM and Google Ads must be connected before setup can start. GBP is optional for audit.'}
            </p>
          ) : null}
        </section>

        <p style={{ margin: '0', fontSize: '0.9rem', color: 'var(--color-muted)' }}>
          Business ID:{' '}
          <code style={{ wordBreak: 'break-all', fontSize: '0.8rem' }}>{businessId}</code>
        </p>
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !canStartSetup}>
            {busy ? <InlineLoading label="Starting…" /> : 'Start setup'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void refetchConnections()}
          >
            Refresh connections
          </button>
        </div>
      </form>
    </PageLayout>
  )
}
