import { useEffect, useState, type FormEvent } from 'react'
import type { ReactElement } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { getBusinessContext } from '../api/businessContexts'
import { startSetupRun } from '../api/setupRuns'
import { GoogleAdsCustomerSelector } from '../components/integrations/GoogleAdsCustomerSelector'
import { MccLinkPanel } from '../components/integrations/MccLinkPanel'
import { GtmResourceSelector } from '../components/integrations/GtmResourceSelector'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import {
  INTEGRATION_PROVIDERS,
  useIntegrationConnections,
} from '../hooks/useIntegrationConnections'
import { optionalIntegrationNudge, requiredProvidersReadyForSetup } from '../lib/provisioningUi'
import {
  adsReadinessIssueMessages,
  isAdsReadinessOk,
} from '../lib/businessContextAdsReadinessUi'
import { useOnboardingState } from '../hooks/useOnboardingState'
import type { AdsReadinessResult } from '../types/api'
import type { IntegrationProvider } from '../api/integrations'

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

function needsOAuthConnect(reason: string | undefined): boolean {
  return (
    reason === 'missing_connection' ||
    reason === 'not_connected' ||
    reason === 'needs_reauth' ||
    reason === 'insufficient_scopes' ||
    reason === 'token_expired' ||
    reason === 'missing_tokens'
  )
}

function showSelectionUi(provider: IntegrationProvider, reason: string | undefined): boolean {
  return (
    (provider === 'gtm' || provider === 'google_ads') && reason === 'selection_required'
  )
}

export function StartSetupPage(): ReactElement {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { snapshot, setSetupRunId } = useOnboardingState()
  const { businessId } = snapshot
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [integrationNotice, setIntegrationNotice] = useState<string | null>(null)
  const [adsReadiness, setAdsReadiness] = useState<AdsReadinessResult | null>(null)

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
    if (!businessId) {
      navigate('/onboarding/business', { replace: true })
      return
    }

    let cancelled = false
    void (async () => {
      try {
        const { businessContext, adsReadiness: readiness } = await getBusinessContext(businessId)
        if (cancelled) return
        setAdsReadiness(readiness)
        if (!businessContext.confirmedAt) {
          navigate('/onboarding/business', { replace: true })
        }
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          navigate('/onboarding/business', { replace: true })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [businessId, navigate])

  useEffect(() => {
    const integration = searchParams.get('integration')
    const provider = searchParams.get('provider')
    const reason = searchParams.get('reason')
    if (!integration) return

    if (integration === 'connected' && provider) {
      setIntegrationNotice(
        provider === 'google_ads' || provider === 'gtm'
          ? `${provider} connected. Select the target account below before starting setup.`
          : `${provider} connected successfully.`,
      )
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
        } else if (err.status === 400 && Array.isArray(err.body?.issues)) {
          setAdsReadiness({ ok: false, issues: err.body.issues })
          setError(err.message)
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

  const businessContextAdsReady = isAdsReadinessOk(adsReadiness)
  const adsReadinessIssues = adsReadinessIssueMessages(adsReadiness)
  const canStartSetup = requiredProvidersReadyForSetup(connections) && businessContextAdsReady
  const optionalNudges = optionalIntegrationNudge(connections)
  const googleAdsConnected = connections.google_ads?.ready === true
  const adsNeedsProvisioning =
    !googleAdsConnected && connections.google_ads?.reason === 'provisioning_required'
  const adsNeedsSelection = connections.google_ads?.reason === 'selection_required'
  const adsCustomerId =
    typeof connections.google_ads?.providerIdentifiers?.customerId === 'string'
      ? connections.google_ads.providerIdentifiers.customerId
      : null
  const adsNeedsMccLink =
    Boolean(adsCustomerId) &&
    !googleAdsConnected &&
    (connections.google_ads?.reason === 'mcc_link_required' ||
      connections.google_ads?.reason === 'mcc_link_pending')

  return (
    <PageLayout
      title="Start setup run"
      lead="Connect Google Ads (required), optionally connect GTM and GBP, then begin the Temporal workflow for this business."
    >
      <form className="form" onSubmit={(e) => void onSubmit(e)}>
        <ErrorAlert message={error ?? connectionsError} />
        {!businessContextAdsReady && adsReadinessIssues.length > 0 ? (
          <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
            <p style={{ margin: '0 0 0.5rem' }}>
              Complete your business requirements before setup can start:
            </p>
            <ul style={{ margin: 0, paddingLeft: '1.25rem' }}>
              {adsReadinessIssues.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}
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
              const reason = status?.reason
              return (
                <li key={provider} style={{ marginBottom: '1rem' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                    <strong>{providerLabels[provider]}</strong>
                    <span className={`statusPill ${ready ? 'status-succeeded' : 'status-review'}`}>
                      {status ? statusLabel(status) : 'Loading…'}
                    </span>
                    {!ready && needsOAuthConnect(reason) ? (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void connectProvider(provider)}
                      >
                        Connect Google
                      </button>
                    ) : null}
                  </div>
                  {ready && status?.providerIdentifiers ? (
                    <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: 'var(--color-muted)' }}>
                      {provider === 'gtm' && status.providerIdentifiers.publicContainerId
                        ? `Container: ${String(status.providerIdentifiers.publicContainerId)}`
                        : null}
                      {provider === 'google_ads' && status.providerIdentifiers.customerId
                        ? `Customer: ${String(status.providerIdentifiers.customerId)}`
                        : null}
                      {provider === 'gbp' && status.providerIdentifiers.locationName
                        ? `Location: ${String(status.providerIdentifiers.locationName)}`
                        : null}
                    </p>
                  ) : null}
                  {showSelectionUi(provider, reason) ? (
                    provider === 'gtm' ? (
                      <GtmResourceSelector businessId={businessId} onSaved={() => void refetchConnections()} />
                    ) : (
                      <GoogleAdsCustomerSelector
                        businessId={businessId}
                        onSaved={() => void refetchConnections()}
                      />
                    )
                  ) : null}
                  {provider === 'google_ads' && adsCustomerId ? (
                    <MccLinkPanel
                      businessId={businessId}
                      customerId={adsCustomerId}
                      onUpdated={() => void refetchConnections()}
                    />
                  ) : null}
                </li>
              )
            })}
          </ul>
          {!canStartSetup ? (
            <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginTop: '0.75rem' }}>
              {!businessContextAdsReady
                ? 'Update your confirmed business context with the required fields above.'
                : adsNeedsSelection
                  ? 'Select your Google Ads customer before setup can start.'
                  : adsNeedsMccLink
                    ? 'Link your selected Google Ads account to the Zuggernaut MCC before setup can start.'
                    : adsNeedsProvisioning
                    ? 'Connect Google Ads via OAuth. If provisioning approval is needed, start setup and approve on the progress screen.'
                    : 'Google Ads must be connected before setup can start. GTM and GBP are optional.'}
            </p>
          ) : optionalNudges.length > 0 ? (
            <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginTop: '0.75rem' }}>
              {optionalNudges.includes('gtm')
                ? 'Google Ads is ready. Connecting GTM is recommended for conversion tags and snippet verification, but setup can proceed without it.'
                : 'Google Ads is ready. Connect Google Business Profile for an optional GBP audit.'}
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
