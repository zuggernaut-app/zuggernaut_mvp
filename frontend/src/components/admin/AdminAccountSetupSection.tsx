import { useEffect, useState, type ReactElement } from 'react'
import { ApiError } from '../../api/client'
import {
  createProvisioningRequest,
  fetchGoogleConnectUrl,
  fetchIntegrationStatus,
  fetchProvisioningOverview,
} from '../../api/integrations'
import type { IntegrationConnectionStatusDto } from '../../api/integrations'
import { integrationStatusLabel } from '../../lib/provisioningUi'
import { ErrorAlert } from '../feedback/ErrorAlert'
import { InlineLoading } from '../feedback/InlineLoading'
import { needsOAuthRepair } from './adminWorkspaceUtils'

type AccountCurrency = 'USD' | 'INR'

interface AdminAccountSetupSectionProps {
  businessId: string
  returnPath: string
}

export function AdminAccountSetupSection({
  businessId,
  returnPath,
}: AdminAccountSetupSectionProps): ReactElement {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [currencyBusy, setCurrencyBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [currencyNotice, setCurrencyNotice] = useState<string | null>(null)
  const [googleAds, setGoogleAds] = useState<IntegrationConnectionStatusDto | null>(null)
  const [currencyCode, setCurrencyCode] = useState<AccountCurrency>('USD')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const [statusRes, provisioningRes] = await Promise.all([
          fetchIntegrationStatus(businessId),
          fetchProvisioningOverview(businessId),
        ])
        if (cancelled) return
        setGoogleAds(statusRes.connections.google_ads ?? null)
        const request =
          provisioningRes.providers.google_ads.activeRequest ??
          provisioningRes.providers.google_ads.latestRequest
        if (request?.currencyCode === 'USD' || request?.currencyCode === 'INR') {
          setCurrencyCode(request.currencyCode)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load account setup.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [businessId])

  async function onReconnect(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetchGoogleConnectUrl('google_ads', businessId, returnPath)
      window.location.assign(res.url)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start Google reconnection.')
      setBusy(false)
    }
  }

  async function onSaveCurrency(): Promise<void> {
    setCurrencyBusy(true)
    setError(null)
    setCurrencyNotice(null)
    try {
      await createProvisioningRequest('google_ads', {
        businessId,
        currencyCode,
      })
      setCurrencyNotice(`Account currency preference saved (${currencyCode}).`)
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not save account currency preference.')
    } finally {
      setCurrencyBusy(false)
    }
  }

  if (loading) {
    return <InlineLoading label="Loading account setup…" />
  }

  const customerId =
    typeof googleAds?.providerIdentifiers?.customerId === 'string'
      ? googleAds.providerIdentifiers.customerId
      : null
  const mccLink =
    googleAds?.providerIdentifiers?.mccLink &&
    typeof googleAds.providerIdentifiers.mccLink === 'object'
      ? (googleAds.providerIdentifiers.mccLink as { status?: string })
      : null
  const showRepair = googleAds && needsOAuthRepair(googleAds.reason)
  const provisioningRequired = googleAds?.reason === 'provisioning_required'

  return (
    <div style={{ maxWidth: '32rem' }}>
      <ErrorAlert message={error} />
      <p style={{ fontSize: '0.9rem', color: 'var(--color-muted)', marginTop: 0 }}>
        Account connections are locked after intake. Use Start setup for GTM, GBP, and starting a
        setup run.
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <strong>Google Ads</strong>
        <span
          className={`statusPill ${googleAds?.ready ? 'status-succeeded' : 'status-review'}`}
        >
          {googleAds ? integrationStatusLabel(googleAds) : 'Unknown'}
        </span>
      </div>
      {customerId ? (
        <p style={{ margin: '0.5rem 0 0', fontSize: '0.85rem', color: 'var(--color-muted)' }}>
          Customer ID: {customerId}
        </p>
      ) : null}
      {mccLink?.status ? (
        <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: 'var(--color-muted)' }}>
          MCC link: {mccLink.status.replace(/_/g, ' ')}
        </p>
      ) : googleAds?.reason === 'mcc_link_required' || googleAds?.reason === 'mcc_link_pending' ? (
        <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem', color: 'var(--color-muted)' }}>
          MCC link: {integrationStatusLabel(googleAds)}
        </p>
      ) : null}
      {provisioningRequired || !customerId ? (
        <div className="field" style={{ marginTop: '1rem' }}>
          <label htmlFor="admin-ads-currency">New account currency</label>
          <select
            id="admin-ads-currency"
            value={currencyCode}
            onChange={(e) => setCurrencyCode(e.target.value as AccountCurrency)}
          >
            <option value="USD">US dollars (USD)</option>
            <option value="INR">Rupees (INR)</option>
          </select>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', margin: '0.35rem 0 0' }}>
            Applies when a new Google Ads account is created. Cannot be changed after the account is
            created.
          </p>
          {currencyNotice ? (
            <p role="status" style={{ margin: '0.5rem 0 0' }}>{currencyNotice}</p>
          ) : null}
          <div className="actions" style={{ marginTop: '0.5rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={currencyBusy}
              onClick={() => void onSaveCurrency()}
            >
              {currencyBusy ? <InlineLoading label="Saving…" /> : 'Save account currency'}
            </button>
          </div>
        </div>
      ) : null}
      {showRepair ? (
        <div className="actions" style={{ marginTop: '0.75rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => void onReconnect()}
          >
            {busy ? <InlineLoading label="Redirecting…" /> : 'Reconnect — restore this account'}
          </button>
        </div>
      ) : null}
    </div>
  )
}
