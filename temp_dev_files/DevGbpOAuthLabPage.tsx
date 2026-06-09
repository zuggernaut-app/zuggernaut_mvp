import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { isDevIntegrationsEnabled } from '../api/devIntegrations'
import {
  createSandboxBusiness,
  fetchGbpOAuthLabConnectUrl,
  runGbpOAuthTrace,
  runGbpReadTest,
  type GbpReadTestResult,
  type OAuthLabStage,
  type OAuthTraceResult,
} from '../api/gbpOAuthLab'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'

function stageStatus(stage: OAuthLabStage): string {
  if (stage.skipped) return 'SKIP'
  return stage.ok ? 'OK' : 'FAIL'
}

function StageLog({ stages, title }: { stages: OAuthLabStage[]; title: string }): ReactElement {
  return (
    <section style={{ marginTop: '1.25rem' }}>
      <h3>{title}</h3>
      <ol className="stepsList">
        {stages.map((stage, index) => (
          <li key={`${stage.id}-${index}`} style={{ marginBottom: '0.75rem' }}>
            <div>
              <strong>
                [{index + 1}/{stages.length}] {stage.label}
              </strong>{' '}
              <span
                className={`statusPill ${
                  stage.skipped ? 'status-review' : stage.ok ? 'status-succeeded' : 'status-failed'
                }`}
              >
                {stageStatus(stage)}
              </span>
            </div>
            {stage.detail ? <div style={{ fontSize: '0.9rem' }}>{stage.detail}</div> : null}
            {!stage.ok && !stage.skipped && stage.hint ? (
              <div style={{ fontSize: '0.85rem', color: '#8b3a3a' }}>Hint: {stage.hint}</div>
            ) : null}
            {stage.data && Object.keys(stage.data).length > 0 ? (
              <pre
                style={{
                  fontSize: '0.75rem',
                  marginTop: '0.35rem',
                  padding: '0.5rem',
                  background: '#f6f6f6',
                  overflowX: 'auto',
                }}
              >
                {JSON.stringify(stage.data, null, 2)}
              </pre>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  )
}

export function DevGbpOAuthLabPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams()
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [oauthTrace, setOauthTrace] = useState<OAuthTraceResult | null>(null)
  const [readResult, setReadResult] = useState<GbpReadTestResult | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const oauthReady = oauthTrace?.oauthLikelyComplete === true
  const canUseApi = oauthReady

  const bootstrap = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const urlBusinessId = searchParams.get('businessId')?.trim()
      if (urlBusinessId) {
        setBusinessId(urlBusinessId)
        return
      }
      const sandbox = await createSandboxBusiness()
      setBusinessId(sandbox.businessId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load GBP OAuth lab.')
    } finally {
      setLoading(false)
    }
  }, [searchParams])

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    const integration = searchParams.get('integration')
    const provider = searchParams.get('provider')
    const reason = searchParams.get('reason')
    if (!integration) return

    if (integration === 'connected' && provider === 'gbp') {
      setNotice('GBP OAuth completed. Run OAuth trace, then read tests.')
      if (businessId) {
        void runGbpOAuthTrace(businessId)
          .then(({ result }) => setOauthTrace(result))
          .catch(() => undefined)
      }
    } else if (integration === 'error') {
      setNotice(reason ? `OAuth failed (${reason}).` : 'OAuth failed.')
    }

    const next = new URLSearchParams(searchParams)
    next.delete('integration')
    next.delete('provider')
    next.delete('reason')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, businessId])

  async function onConnect(): Promise<void> {
    if (!businessId) return
    setBusy('connect')
    setError(null)
    try {
      const res = await fetchGbpOAuthLabConnectUrl(businessId)
      window.location.assign(res.url)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start OAuth.')
      setBusy(null)
    }
  }

  async function onRunOAuthTrace(): Promise<void> {
    if (!businessId) return
    setBusy('oauth-trace')
    setError(null)
    setOauthTrace(null)
    try {
      const { result } = await runGbpOAuthTrace(businessId)
      setOauthTrace(result)
      if (result.firstFailure) {
        setError(`${result.firstFailure.label}: ${result.firstFailure.detail ?? 'failed'}`)
      } else {
        setError(null)
        setNotice('OAuth trace passed — run read tests to fetch profile data.')
      }
    } catch (err) {
      if (err instanceof ApiError && err.body && typeof err.body === 'object') {
        const body = err.body as { result?: OAuthTraceResult }
        if (body.result) setOauthTrace(body.result)
      }
      setError(err instanceof ApiError ? err.message : 'OAuth trace failed.')
    } finally {
      setBusy(null)
    }
  }

  async function onRunReadTest(): Promise<void> {
    if (!businessId) return
    setBusy('read-test')
    setError(null)
    setReadResult(null)
    try {
      const { result } = await runGbpReadTest(businessId)
      setReadResult(result)
      if (result.ok) {
        setNotice('GBP read tests passed.')
        setError(null)
      } else if (result.firstFailure) {
        setError(
          `${result.firstFailure.label ?? result.firstFailure.id}: ${result.firstFailure.detail ?? 'failed'}`,
        )
      }
    } catch (err) {
      if (err instanceof ApiError && err.body && typeof err.body === 'object') {
        const body = err.body as { result?: GbpReadTestResult }
        if (body.result) setReadResult(body.result)
      }
      setError(err instanceof ApiError ? err.message : 'GBP read test failed.')
    } finally {
      setBusy(null)
    }
  }

  if (!isDevIntegrationsEnabled()) {
    return (
      <PageLayout title="GBP OAuth lab">
        <p>
          Dev integration diagnostics are disabled. Set VITE_ENABLE_INTEGRATION_DIAGNOSTICS=true in
          development.
        </p>
      </PageLayout>
    )
  }

  if (loading) {
    return (
      <PageLayout title="GBP OAuth lab">
        <InlineLoading label="Loading sandbox business…" />
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="GBP OAuth lab"
      subtitle="OAuth → read-only profile audit tests. GBP writes are not supported in V1."
    >
      <p style={{ marginBottom: '1rem' }}>
        <Link to="/dev/integrations">← All integration diagnostics</Link>
      </p>

      {error ? <ErrorAlert message={error} /> : null}
      {notice ? (
        <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
          {notice}
        </div>
      ) : null}

      <section>
        <h3>Sandbox context</h3>
        <p>
          <strong>Sandbox business:</strong> <code>{businessId}</code>
        </p>
        <p style={{ fontSize: '0.9rem' }}>
          Google Business Profile integration is read-only in V1. This lab verifies OAuth, account
          discovery, and profile reads — not mutations.
        </p>
      </section>

      <section style={{ marginTop: '1.25rem' }}>
        <h3>1. OAuth</h3>
        <div className="actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy !== null}
            onClick={() => void onConnect()}
          >
            {busy === 'connect' ? 'Redirecting…' : 'Connect (OAuth)'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy !== null}
            onClick={() => void onRunOAuthTrace()}
          >
            {busy === 'oauth-trace' ? 'Running trace…' : 'Run OAuth trace'}
          </button>
        </div>
      </section>

      {oauthTrace ? <StageLog stages={oauthTrace.stages} title="OAuth trace log" /> : null}

      <section style={{ marginTop: '1.25rem', opacity: canUseApi ? 1 : 0.55 }}>
        <h3>2. Read API tests</h3>
        <p style={{ fontSize: '0.85rem' }}>
          Lists GBP accounts and locations, then reads the location profile (name, website, category,
          phone, service areas).
        </p>
        <div className="actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!canUseApi || busy !== null}
            onClick={() => void onRunReadTest()}
          >
            {busy === 'read-test' ? 'Running read tests…' : 'Run read tests'}
          </button>
        </div>
      </section>

      {readResult ? (
        <>
          <p style={{ marginTop: '1rem' }}>
            Read tests — location ready: {readResult.locationReady ? 'yes' : 'no'} —{' '}
            {readResult.summary.passed}/{readResult.summary.total} passed
          </p>
          <StageLog stages={readResult.stages} title="Read test log" />
        </>
      ) : null}

      <div className="actions" style={{ marginTop: '1.5rem' }}>
        <button type="button" className="btn btn-secondary" onClick={() => void bootstrap()}>
          Reload sandbox
        </button>
      </div>
    </PageLayout>
  )
}
