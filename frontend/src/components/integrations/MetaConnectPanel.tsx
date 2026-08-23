import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { ApiError } from '../../api/client'
import { getMetaConnectUrl, getMetaStatus, runMetaSetup } from '../../api/integrations'
import { ErrorAlert } from '../feedback/ErrorAlert'
import { InlineLoading } from '../feedback/InlineLoading'

interface MetaConnectPanelProps {
  businessId: string
}

export function MetaConnectPanel({ businessId }: MetaConnectPanelProps): ReactElement {
  const [connectUrl, setConnectUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [urlRes, statusRes] = await Promise.all([getMetaConnectUrl(), getMetaStatus(businessId)])
      setConnectUrl(urlRes.url)
      setStatus(statusRes.status)
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not load Meta status.')
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function onRunSetup(): Promise<void> {
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await runMetaSetup(businessId)
      setMessage(`Meta setup: ${String(res.step ?? 'complete')}`)
      await refresh()
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Meta setup failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h3>Meta Ads</h3>
      <ErrorAlert message={error} />
      {message ? <p className="notice">{message}</p> : null}
      {loading ? (
        <InlineLoading label="Loading Meta status…" />
      ) : (
        <div className="actions" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <p>Connected: {String(status?.connected ?? false)}</p>
          {connectUrl ? (
            <a className="btn btn-secondary" href={connectUrl} target="_blank" rel="noreferrer">
              Connect Meta
            </a>
          ) : null}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onRunSetup()}>
            Run Meta setup
          </button>
        </div>
      )}
    </section>
  )
}
