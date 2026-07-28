import { useEffect, useState, type ReactElement } from 'react'
import { ApiError } from '../../api/client'
import {
  getMccLinkStatus,
  sendMccLinkInvite,
  type MccLinkState,
  type MccLinkManualAcceptInstructions,
} from '../../api/integrations'
import { ErrorAlert } from '../feedback/ErrorAlert'
import { InlineLoading } from '../feedback/InlineLoading'

interface MccLinkPanelProps {
  businessId: string
  customerId: string
  onUpdated: () => void
}

function statusPillClass(status: MccLinkState['status']): string {
  if (status === 'ACTIVE') return 'status-succeeded'
  if (status === 'PENDING') return 'status-review'
  return 'status-review'
}

function statusLabel(status: MccLinkState['status']): string {
  if (status === 'ACTIVE') return 'Linked to Zuggernaut MCC'
  if (status === 'PENDING') return 'Invitation pending'
  return 'Link required'
}

export function MccLinkPanel({
  businessId,
  customerId,
  onUpdated,
}: MccLinkPanelProps): ReactElement {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mccLink, setMccLink] = useState<MccLinkState | null>(null)
  const [manualAccept, setManualAccept] = useState<MccLinkManualAcceptInstructions | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const res = await getMccLinkStatus(businessId, { refresh: true })
        if (cancelled) return
        setMccLink(res.mccLink)
        setManualAccept(res.manualAccept)
        onUpdated()
      } catch (err) {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Could not load MCC link status.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [businessId, customerId])

  async function onSendInvite(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await sendMccLinkInvite(businessId)
      setMccLink(res.mccLink)
      setManualAccept(res.manualAccept)
      onUpdated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send MCC link invite.')
    } finally {
      setBusy(false)
    }
  }

  async function onVerifyLink(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const res = await getMccLinkStatus(businessId, { refresh: true })
      setMccLink(res.mccLink)
      setManualAccept(res.manualAccept)
      onUpdated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not verify MCC link.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <InlineLoading label="Checking MCC link status…" />
  }

  const status = mccLink?.status ?? 'REQUIRED'
  const isActive = status === 'ACTIVE'

  return (
    <div className="form" style={{ marginTop: '0.75rem' }}>
      <h3 style={{ fontSize: '0.95rem', margin: '0 0 0.5rem' }}>Link Google Ads to Zuggernaut MCC</h3>
      <ErrorAlert message={error} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center', marginBottom: '0.75rem' }}>
        <span className={`statusPill ${statusPillClass(status)}`}>{statusLabel(status)}</span>
        <span style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>
          Customer {customerId}
        </span>
      </div>

      {!isActive ? (
        <>
          <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginTop: 0 }}>
            {status === 'PENDING'
              ? 'An invitation was sent. Accept it in Google Ads, then verify the link here.'
              : 'Send an invitation to link this Google Ads account under the Zuggernaut manager account before setup can start.'}
          </p>
          {manualAccept ? (
            <div style={{ fontSize: '0.875rem', marginBottom: '0.75rem' }}>
              <p style={{ margin: '0 0 0.5rem' }}>{manualAccept.summary}</p>
              <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
                {manualAccept.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
              <p style={{ margin: '0.5rem 0 0' }}>
                <a href={manualAccept.googleAdsUrl} target="_blank" rel="noreferrer">
                  Open Google Ads manager access
                </a>
              </p>
            </div>
          ) : null}
          <div className="actions">
            {status !== 'PENDING' ? (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => void onSendInvite()}
              >
                {busy ? <InlineLoading label="Sending…" /> : 'Send invite'}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={() => void onVerifyLink()}
            >
              {busy ? <InlineLoading label="Verifying…" /> : 'Verify link'}
            </button>
          </div>
        </>
      ) : (
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', margin: 0 }}>
          This Google Ads account is linked to the Zuggernaut MCC. You can start setup.
        </p>
      )}
    </div>
  )
}
