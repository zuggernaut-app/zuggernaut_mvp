import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { isDevIntegrationsEnabled } from '../api/devIntegrations'
import {
  createSandboxBusiness,
  fetchGoogleAdsOAuthLabConnectUrl,
  fetchGoogleAdsResourceOptions,
  runGoogleAdsMccLink,
  runGoogleAdsOAuthTrace,
  runGoogleAdsReadWriteTest,
  type GoogleAdsResourceOptionsResult,
  type MccLinkResult,
  type OAuthLabStage,
  type OAuthTraceResult,
  type ReadWriteTestResult,
} from '../api/googleAdsOAuthLab'
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

export function DevGoogleAdsOAuthLabPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams()
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [oauthTrace, setOauthTrace] = useState<OAuthTraceResult | null>(null)
  const [mccLinkResult, setMccLinkResult] = useState<MccLinkResult | null>(null)
  const [readWriteResult, setReadWriteResult] = useState<ReadWriteTestResult | null>(null)
  const [adsResources, setAdsResources] = useState<GoogleAdsResourceOptionsResult | null>(null)
  const [draftManagerId, setDraftManagerId] = useState<string | null>(null)
  const [draftClientId, setDraftClientId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const oauthReady = oauthTrace?.oauthLikelyComplete === true
  const canUseAdsApi =
    oauthReady || (adsResources?.options != null && adsResources.options.length > 0)
  const linkReady = mccLinkResult?.linkReady === true

  const managerOptions = useMemo(
    () => adsResources?.options.filter((opt) => opt.kind === 'manager') ?? [],
    [adsResources],
  )
  const clientOptions = useMemo(
    () => adsResources?.options.filter((opt) => opt.kind === 'client') ?? [],
    [adsResources],
  )

  const loadResources = useCallback(async (bid: string) => {
    try {
      const { result } = await fetchGoogleAdsResourceOptions(bid)
      setAdsResources(result)
      const manager =
        result.loginCustomerId ??
        result.options.find((row) => row.kind === 'manager')?.customerId ??
        null
      const client =
        result.selected?.customerId ??
        result.suggestedCustomerId ??
        result.options.find((row) => row.kind === 'client' && row.selectable)?.customerId ??
        result.options.find((row) => row.kind === 'client')?.customerId ??
        null
      setDraftManagerId(manager)
      setDraftClientId(client)
    } catch {
      setAdsResources(null)
      setDraftManagerId(null)
      setDraftClientId(null)
    }
  }, [])

  const bootstrap = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const urlBusinessId = searchParams.get('businessId')?.trim()
      if (urlBusinessId) {
        setBusinessId(urlBusinessId)
        await loadResources(urlBusinessId)
        return
      }
      const sandbox = await createSandboxBusiness()
      setBusinessId(sandbox.businessId)
      await loadResources(sandbox.businessId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load Google Ads OAuth lab.')
    } finally {
      setLoading(false)
    }
  }, [loadResources, searchParams])

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    const integration = searchParams.get('integration')
    const provider = searchParams.get('provider')
    const reason = searchParams.get('reason')
    if (!integration) return

    if (integration === 'connected' && provider === 'google_ads') {
      setNotice(
        'Google Ads OAuth completed. Run OAuth trace, then link the client account to your MCC.',
      )
      if (businessId) {
        void loadResources(businessId)
        void runGoogleAdsOAuthTrace(businessId)
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
  }, [searchParams, setSearchParams, businessId, loadResources])

  async function onConnect(): Promise<void> {
    if (!businessId) return
    setBusy('connect')
    setError(null)
    try {
      const res = await fetchGoogleAdsOAuthLabConnectUrl(businessId)
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
      const { result } = await runGoogleAdsOAuthTrace(businessId)
      setOauthTrace(result)
      await loadResources(businessId)
      if (result.firstFailure) {
        setError(`${result.firstFailure.label}: ${result.firstFailure.detail ?? 'failed'}`)
      } else {
        setError(null)
        setNotice('OAuth trace passed — proceed to MCC linking.')
      }
    } catch (err) {
      if (err instanceof ApiError && err.body && typeof err.body === 'object') {
        const body = err.body as { result?: OAuthTraceResult }
        if (body.result) {
          setOauthTrace(body.result)
        }
      }
      setError(err instanceof ApiError ? err.message : 'OAuth trace failed.')
    } finally {
      setBusy(null)
    }
  }

  async function runMccLinkAction(options: {
    sendInvitation?: boolean
    acceptLink?: boolean
    busyKey: string
  }): Promise<void> {
    if (!businessId || !draftManagerId || !draftClientId) return
    setBusy(options.busyKey)
    setError(null)
    setMccLinkResult(null)
    try {
      const { result } = await runGoogleAdsMccLink(businessId, {
        managerCustomerId: draftManagerId,
        clientCustomerId: draftClientId,
        sendInvitation: options.sendInvitation,
        acceptLink: options.acceptLink,
      })
      setMccLinkResult(result)
      if (result.linkReady) {
        setNotice('MCC link is ACTIVE — you can run read/write tests.')
        setError(null)
      } else if (result.firstFailure) {
        setError(`${result.firstFailure.label}: ${result.firstFailure.detail ?? 'failed'}`)
      } else {
        setNotice(result.message)
      }
    } catch (err) {
      if (err instanceof ApiError && err.body && typeof err.body === 'object') {
        const body = err.body as { result?: MccLinkResult }
        if (body.result) {
          setMccLinkResult(body.result)
        }
      }
      setError(err instanceof ApiError ? err.message : 'MCC link step failed.')
    } finally {
      setBusy(null)
    }
  }

  async function onRunReadWrite(mode: 'read' | 'write'): Promise<void> {
    if (!businessId || !draftManagerId || !draftClientId) return
    const busyKey = mode === 'read' ? 'read-test' : 'write-test'
    setBusy(busyKey)
    setError(null)
    setReadWriteResult(null)
    try {
      const { result } = await runGoogleAdsReadWriteTest(businessId, {
        customerId: draftClientId,
        managerCustomerId: draftManagerId,
        mode,
      })
      setReadWriteResult(result)
      if (result.linkReady && result.ok) {
        setNotice(
          mode === 'read' ? 'Read tests passed.' : 'Write tests passed.',
        )
        setError(null)
      } else if (!result.ok && result.firstFailure) {
        setError(
          `${result.firstFailure.label ?? result.firstFailure.id}: ${result.firstFailure.detail ?? 'failed'}`,
        )
      } else if (!result.linkReady) {
        setNotice(result.message)
      }
    } catch (err) {
      if (err instanceof ApiError && err.body && typeof err.body === 'object') {
        const body = err.body as { result?: ReadWriteTestResult }
        if (body.result) {
          setReadWriteResult(body.result)
        }
      }
      setError(
        err instanceof ApiError
          ? err.message
          : mode === 'read'
            ? 'Read test failed.'
            : 'Write test failed.',
      )
    } finally {
      setBusy(null)
    }
  }

  if (!isDevIntegrationsEnabled()) {
    return (
      <PageLayout title="Google Ads OAuth lab">
        <p>
          Dev integration diagnostics are disabled. Set VITE_ENABLE_INTEGRATION_DIAGNOSTICS=true in
          development.
        </p>
      </PageLayout>
    )
  }

  if (loading) {
    return (
      <PageLayout title="Google Ads OAuth lab">
        <InlineLoading label="Loading sandbox business…" />
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="Google Ads OAuth lab"
      subtitle="OAuth → link client to MCC → read/write tests, with per-stage logs."
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
          OAuth tokens are stored per <code>businessId</code>. The Google account you pick during
          Connect (OAuth) must have access on both the MCC (manager) and client accounts for linking
          and API calls.
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
        <p style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>
          Complete OAuth first. The trace verifies stored tokens and{' '}
          <code>listAccessibleCustomers</code>.
        </p>
      </section>

      {oauthTrace ? <StageLog stages={oauthTrace.stages} title="OAuth trace log" /> : null}

      <section style={{ marginTop: '1.25rem', opacity: canUseAdsApi ? 1 : 0.55 }}>
        <h3>2. Link client account to MCC</h3>
        <p style={{ fontSize: '0.85rem' }}>
          Requires stored OAuth tokens (Connect OAuth). OAuth trace is optional but useful for
          debugging. Manager sends a <code>PENDING</code> invitation; client accepts as{' '}
          <code>ACTIVE</code>.
        </p>
        {adsResources && adsResources.options.length > 0 ? (
          <>
            <label htmlFor="ads-manager-select">Manager account (MCC)</label>
            <select
              id="ads-manager-select"
              className="input"
              value={draftManagerId ?? ''}
              onChange={(e) => setDraftManagerId(e.target.value || null)}
              disabled={!canUseAdsApi}
            >
              <option value="">Select manager…</option>
              {managerOptions.map((opt) => (
                <option key={opt.customerId} value={opt.customerId}>
                  {opt.formattedCustomerId ?? opt.customerId}
                  {opt.descriptiveName ? ` — ${opt.descriptiveName}` : ''}
                </option>
              ))}
            </select>

            <label htmlFor="ads-client-select" style={{ display: 'block', marginTop: '0.75rem' }}>
              Client account to link
            </label>
            <select
              id="ads-client-select"
              className="input"
              value={draftClientId ?? ''}
              onChange={(e) => setDraftClientId(e.target.value || null)}
              disabled={!canUseAdsApi}
            >
              <option value="">Select client…</option>
              {clientOptions.map((opt) => (
                <option key={opt.customerId} value={opt.customerId}>
                  {opt.formattedCustomerId ?? opt.customerId}
                  {opt.descriptiveName ? ` — ${opt.descriptiveName}` : ''}
                  {opt.testAccount ? ' (test)' : ''}
                </option>
              ))}
            </select>

            <div className="actions" style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!canUseAdsApi || !draftManagerId || !draftClientId || busy !== null}
                onClick={() =>
                  void runMccLinkAction({ busyKey: 'mcc-check', sendInvitation: false })
                }
              >
                {busy === 'mcc-check' ? 'Checking…' : 'Check link status'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!canUseAdsApi || !draftManagerId || !draftClientId || busy !== null}
                onClick={() =>
                  void runMccLinkAction({ busyKey: 'mcc-invite', sendInvitation: true })
                }
              >
                {busy === 'mcc-invite' ? 'Sending…' : 'Send link invitation'}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={!canUseAdsApi || !draftManagerId || !draftClientId || busy !== null}
                onClick={() =>
                  void runMccLinkAction({
                    busyKey: 'mcc-accept',
                    sendInvitation: false,
                    acceptLink: true,
                  })
                }
              >
                {busy === 'mcc-accept' ? 'Accepting…' : 'Accept link (client)'}
              </button>
            </div>
          </>
        ) : (
          <p style={{ fontSize: '0.9rem' }}>
            Connect OAuth first to load accessible accounts, or set{' '}
            <code>GOOGLE_ADS_LOGIN_CUSTOMER_ID</code> in backend/.env.
          </p>
        )}
      </section>

      {mccLinkResult ? (
        <>
          <p style={{ marginTop: '1rem' }}>
            Link ready: {mccLinkResult.linkReady ? 'yes' : 'no'} — {mccLinkResult.message}
          </p>
          <StageLog stages={mccLinkResult.stages} title="MCC link log" />
        </>
      ) : null}

      <section style={{ marginTop: '1.25rem', opacity: canUseAdsApi ? 1 : 0.55 }}>
        <h3>3. Read / write API tests</h3>
        <p style={{ fontSize: '0.85rem' }}>
          Each test verifies the MCC link is <code>ACTIVE</code> before calling the Google Ads API.
          Read tests list existing campaigns. Write tests create a paused SEARCH campaign (budget +
          campaign) for sandbox verification.
          {linkReady ? ' Link is ready.' : ' Run “Check link status” if you already accepted in Google Ads UI.'}
        </p>
        <div className="actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!canUseAdsApi || !draftManagerId || !draftClientId || busy !== null}
            onClick={() => void onRunReadWrite('read')}
          >
            {busy === 'read-test' ? 'Running read tests…' : 'Run read tests'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!canUseAdsApi || !draftManagerId || !draftClientId || busy !== null}
            onClick={() => void onRunReadWrite('write')}
          >
            {busy === 'write-test' ? 'Running write tests…' : 'Run write tests'}
          </button>
        </div>
      </section>

      {readWriteResult ? (
        <>
          <p style={{ marginTop: '1rem' }}>
            {readWriteResult.mode === 'read' ? 'Read' : 'Write'} tests — link ready:{' '}
            {readWriteResult.linkReady ? 'yes' : 'no'} —{' '}
            {readWriteResult.summary.passed}/{readWriteResult.summary.total} passed
            {readWriteResult.summary.skipped > 0
              ? ` (${readWriteResult.summary.skipped} skipped)`
              : ''}
          </p>
          <StageLog
            stages={readWriteResult.stages}
            title={`${readWriteResult.mode === 'read' ? 'Read' : 'Write'} test log`}
          />
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
