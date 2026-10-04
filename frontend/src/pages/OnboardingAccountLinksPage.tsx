import { useEffect, useState, type ReactElement } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { completeAccountLinks, createBusinessDraft } from '../api/onboarding'
import { getBusinessContext } from '../api/businessContexts'
import { ApiError } from '../api/client'
import { GoogleAdsCustomerSelector } from '../components/integrations/GoogleAdsCustomerSelector'
import { GtmResourceSelector } from '../components/integrations/GtmResourceSelector'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import {
  INTEGRATION_PROVIDERS,
  useIntegrationConnections,
} from '../hooks/useIntegrationConnections'
import { isQuestionsComplete } from '../lib/onboardingRouting'
import { useAuth } from '../hooks/useAuth'
import { notifyOnboardingStorageChanged, useOnboardingState } from '../hooks/useOnboardingState'
import { clearOnboardingDrafts } from '../utils/storage'
import type { IntegrationProvider } from '../api/integrations'

const RETURN_PATH = '/onboarding/accounts'

const ACCOUNT_LINK_LABELS: Record<IntegrationProvider, string> = {
  google_ads: 'Google Ads (optional)',
  gtm: 'Google Tag Manager (optional)',
  gbp: 'Google Business Profile (optional)',
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

export function OnboardingAccountLinksPage(): ReactElement {
  const navigate = useNavigate()
  const location = useLocation()
  const editMode = (location.state as { editMode?: boolean } | null)?.editMode === true
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const { snapshot, setBusinessId } = useOnboardingState()
  const businessId = snapshot.businessId ?? user?.primaryBusinessId ?? null

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [integrationNotice, setIntegrationNotice] = useState<string | null>(null)
  const [contextLoading, setContextLoading] = useState(true)

  const {
    connections,
    loading: connectionsLoading,
    error: connectionsError,
    refetch: refetchConnections,
    connectProvider,
    statusLabel,
  } = useIntegrationConnections(businessId)

  useEffect(() => {
    if (!user) {
      setContextLoading(false)
      return
    }

    const resolvedId = snapshot.businessId ?? user.primaryBusinessId ?? null
    if (resolvedId) {
      if (!snapshot.businessId && user.primaryBusinessId) {
        setBusinessId(user.primaryBusinessId)
      }
      return
    }

    let cancelled = false
    void (async () => {
      setContextLoading(true)
      setError(null)
      try {
        const draft = await createBusinessDraft()
        if (!cancelled) setBusinessId(draft.businessId)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not start onboarding.')
          setContextLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [user, snapshot.businessId, user?.primaryBusinessId, setBusinessId])

  useEffect(() => {
    if (!businessId) return
    let cancelled = false
    void (async () => {
      setContextLoading(true)
      try {
        const res = await getBusinessContext(businessId)
        if (!cancelled) {
          if (!editMode && isQuestionsComplete(res.businessContext)) {
            navigate('/onboarding/thank-you', { replace: true })
            return
          }
          if (!editMode && res.businessContext.accountLinksCompletedAt) {
            navigate('/onboarding/business', { replace: true })
          }
        }
      } catch (err) {
        if (!cancelled && err instanceof ApiError && err.status === 404) {
          clearOnboardingDrafts()
          notifyOnboardingStorageChanged()
        }
      } finally {
        if (!cancelled) setContextLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [businessId, navigate, editMode])

  useEffect(() => {
    const integration = searchParams.get('integration')
    const provider = searchParams.get('provider')
    const reason = searchParams.get('reason')
    if (!integration) return

    if (integration === 'connected' && provider) {
      setIntegrationNotice(
        provider === 'google_ads' || provider === 'gtm'
          ? `${provider} connected. Select your account below if prompted.`
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

  async function onNext(): Promise<void> {
    if (!businessId) return
    setError(null)
    setBusy(true)
    try {
      await completeAccountLinks(businessId)
      navigate('/onboarding/business', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not continue.')
    } finally {
      setBusy(false)
    }
  }

  if (!businessId && !contextLoading) {
    return (
      <PageLayout title="Connect your accounts">
        <ErrorAlert message={error ?? 'Could not start onboarding.'} />
      </PageLayout>
    )
  }

  if (contextLoading || !businessId) {
    return (
      <PageLayout title="Connect your accounts">
        <InlineLoading label="Loading…" />
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="Connect your accounts"
      lead="Link Google Ads, Tag Manager, and Business Profile if you like — you can skip any of these and continue."
    >
      <ErrorAlert message={error ?? connectionsError} />
      {integrationNotice ? (
        <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
          {integrationNotice}
        </div>
      ) : null}

      <section style={{ marginBottom: '1.5rem' }}>
        {connectionsLoading && !connections.google_ads ? (
          <InlineLoading label="Loading connections…" />
        ) : null}
        <ul className="stepsList">
          {INTEGRATION_PROVIDERS.map((provider) => {
            const status = connections[provider]
            const ready = status?.ready === true
            const reason = status?.reason
            return (
              <li key={provider} style={{ marginBottom: '1rem' }}>
                <div
                  style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}
                >
                  <strong>{ACCOUNT_LINK_LABELS[provider]}</strong>
                  <span className={`statusPill ${ready ? 'status-succeeded' : 'status-review'}`}>
                    {status ? statusLabel(status) : 'Loading…'}
                  </span>
                  {!ready && needsOAuthConnect(reason) ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => void connectProvider(provider, RETURN_PATH)}
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
                    <GtmResourceSelector
                      businessId={businessId}
                      onSaved={() => void refetchConnections()}
                    />
                  ) : (
                    <GoogleAdsCustomerSelector
                      businessId={businessId}
                      onSaved={() => void refetchConnections()}
                    />
                  )
                ) : null}
              </li>
            )
          })}
        </ul>
      </section>

      <div className="actions">
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onNext()}>
          {busy ? <InlineLoading label="Continuing…" /> : 'Next'}
        </button>
      </div>
    </PageLayout>
  )
}
