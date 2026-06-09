import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError } from '../../../../../frontend/src/api/client'
import { isDevIntegrationsEnabled } from '../../api/dev/devIntegrations'
import {
  createSandboxBusiness,
  fetchGtmOAuthLabConnectUrl,
  fetchGtmResourceOptions,
  runGtmOAuthTrace,
  runGtmReadWriteTest,
  saveGtmSelection,
  type GtmResourceOptionsResult,
  type GtmReadWriteTestResult,
  type OAuthLabStage,
  type OAuthTraceResult,
} from '../../api/dev/gtmOAuthLab'
import { ErrorAlert } from '../../../../../frontend/src/components/feedback/ErrorAlert'
import { InlineLoading } from '../../../../../frontend/src/components/feedback/InlineLoading'
import { PageLayout } from '../../../../../frontend/src/components/layout/PageLayout'

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

export function DevGtmOAuthLabPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams()
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [oauthTrace, setOauthTrace] = useState<OAuthTraceResult | null>(null)
  const [testResult, setTestResult] = useState<GtmReadWriteTestResult | null>(null)
  const [gtmResources, setGtmResources] = useState<GtmResourceOptionsResult | null>(null)
  const [draftAccountId, setDraftAccountId] = useState<string | null>(null)
  const [draftContainerId, setDraftContainerId] = useState<string | null>(null)
  const [draftWorkspaceId, setDraftWorkspaceId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const oauthReady = oauthTrace?.oauthLikelyComplete === true
  const canUseApi =
    oauthReady || (gtmResources?.accounts != null && gtmResources.accounts.length > 0)

  const selectedAccount = useMemo(
    () => gtmResources?.accounts.find((a) => a.accountId === draftAccountId) ?? null,
    [gtmResources, draftAccountId],
  )
  const containerOptions = selectedAccount?.containers ?? []
  const selectedContainer = useMemo(
    () => containerOptions.find((c) => c.containerId === draftContainerId) ?? null,
    [containerOptions, draftContainerId],
  )
  const workspaceOptions = selectedContainer?.workspaces ?? []

  const loadResources = useCallback(async (bid: string) => {
    try {
      const { result } = await fetchGtmResourceOptions(bid)
      setGtmResources(result)
      const account = result.selected
        ? result.accounts.find((a) => a.accountId === result.selected?.accountId) ??
          result.accounts[0]
        : result.accounts[0]
      const container =
        result.selected && account
          ? account.containers.find((c) => c.containerId === result.selected?.containerId) ??
            account.containers[0]
          : account?.containers[0]
      const workspace =
        result.selected && container
          ? container.workspaces.find((w) => w.workspaceId === result.selected?.workspaceId) ??
            container.workspaces[0]
          : container?.workspaces[0]
      setDraftAccountId(account?.accountId ?? null)
      setDraftContainerId(container?.containerId ?? null)
      setDraftWorkspaceId(workspace?.workspaceId ?? null)
    } catch {
      setGtmResources(null)
      setDraftAccountId(null)
      setDraftContainerId(null)
      setDraftWorkspaceId(null)
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
      setError(err instanceof ApiError ? err.message : 'Failed to load GTM OAuth lab.')
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

    if (integration === 'connected' && provider === 'gtm') {
      setNotice('GTM OAuth completed. Run OAuth trace, then select a workspace for API tests.')
      if (businessId) {
        void loadResources(businessId)
        void runGtmOAuthTrace(businessId)
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
      const res = await fetchGtmOAuthLabConnectUrl(businessId)
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
      const { result } = await runGtmOAuthTrace(businessId)
      setOauthTrace(result)
      await loadResources(businessId)
      if (result.firstFailure) {
        setError(`${result.firstFailure.label}: ${result.firstFailure.detail ?? 'failed'}`)
      } else {
        setError(null)
        setNotice('OAuth trace passed — select a workspace and run API tests.')
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

  async function onSaveSelection(): Promise<void> {
    if (!businessId || !draftAccountId || !draftContainerId || !draftWorkspaceId) return
    setBusy('save-selection')
    setError(null)
    try {
      await saveGtmSelection(businessId, {
        accountId: draftAccountId,
        containerId: draftContainerId,
        workspaceId: draftWorkspaceId,
      })
      setNotice('GTM workspace selection saved.')
      await loadResources(businessId)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save GTM selection.')
    } finally {
      setBusy(null)
    }
  }

  async function onRunTests(mode: 'read' | 'write'): Promise<void> {
    if (!businessId || !draftAccountId || !draftContainerId || !draftWorkspaceId) return
    const busyKey = mode === 'read' ? 'read-test' : 'write-test'
    setBusy(busyKey)
    setError(null)
    setTestResult(null)
    try {
      const { result } = await runGtmReadWriteTest(businessId, {
        accountId: draftAccountId,
        containerId: draftContainerId,
        workspaceId: draftWorkspaceId,
        mode,
      })
      setTestResult(result)
      if (result.ok) {
        setNotice(mode === 'read' ? 'GTM read tests passed.' : 'GTM write tests passed.')
        setError(null)
      } else if (result.firstFailure) {
        setError(
          `${result.firstFailure.label ?? result.firstFailure.id}: ${result.firstFailure.detail ?? 'failed'}`,
        )
      }
    } catch (err) {
      if (err instanceof ApiError && err.body && typeof err.body === 'object') {
        const body = err.body as { result?: GtmReadWriteTestResult }
        if (body.result) setTestResult(body.result)
      }
      setError(err instanceof ApiError ? err.message : 'GTM test failed.')
    } finally {
      setBusy(null)
    }
  }

  if (!isDevIntegrationsEnabled()) {
    return (
      <PageLayout title="GTM OAuth lab">
        <p>
          Dev integration diagnostics are disabled. Set VITE_ENABLE_INTEGRATION_DIAGNOSTICS=true in
          development.
        </p>
      </PageLayout>
    )
  }

  if (loading) {
    return (
      <PageLayout title="GTM OAuth lab">
        <InlineLoading label="Loading sandbox business…" />
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="GTM OAuth lab"
      subtitle="OAuth → select workspace → read/write API tests, with per-stage logs."
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
        <h3>2. Select GTM workspace</h3>
        {gtmResources && gtmResources.accounts.length > 0 ? (
          <>
            <label htmlFor="gtm-account-select">Account</label>
            <select
              id="gtm-account-select"
              className="input"
              value={draftAccountId ?? ''}
              onChange={(e) => {
                const accountId = e.target.value || null
                setDraftAccountId(accountId)
                const account = gtmResources.accounts.find((a) => a.accountId === accountId)
                const container = account?.containers[0]
                setDraftContainerId(container?.containerId ?? null)
                setDraftWorkspaceId(container?.workspaces[0]?.workspaceId ?? null)
              }}
              disabled={!canUseApi}
            >
              <option value="">Select account…</option>
              {gtmResources.accounts.map((account) => (
                <option key={account.accountId} value={account.accountId}>
                  {account.name ?? account.accountId}
                </option>
              ))}
            </select>

            <label htmlFor="gtm-container-select" style={{ display: 'block', marginTop: '0.75rem' }}>
              Container
            </label>
            <select
              id="gtm-container-select"
              className="input"
              value={draftContainerId ?? ''}
              onChange={(e) => {
                const containerId = e.target.value || null
                setDraftContainerId(containerId)
                const container = containerOptions.find((c) => c.containerId === containerId)
                setDraftWorkspaceId(container?.workspaces[0]?.workspaceId ?? null)
              }}
              disabled={!canUseApi || !draftAccountId}
            >
              <option value="">Select container…</option>
              {containerOptions.map((container) => (
                <option key={container.containerId} value={container.containerId}>
                  {container.name ?? container.containerId}
                  {container.publicContainerId ? ` (${container.publicContainerId})` : ''}
                </option>
              ))}
            </select>

            <label htmlFor="gtm-workspace-select" style={{ display: 'block', marginTop: '0.75rem' }}>
              Workspace
            </label>
            <select
              id="gtm-workspace-select"
              className="input"
              value={draftWorkspaceId ?? ''}
              onChange={(e) => setDraftWorkspaceId(e.target.value || null)}
              disabled={!canUseApi || !draftContainerId}
            >
              <option value="">Select workspace…</option>
              {workspaceOptions.map((workspace) => (
                <option key={workspace.workspaceId} value={workspace.workspaceId}>
                  {workspace.name ?? workspace.workspaceId}
                </option>
              ))}
            </select>

            <div className="actions" style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={
                  !canUseApi ||
                  !draftAccountId ||
                  !draftContainerId ||
                  !draftWorkspaceId ||
                  busy !== null
                }
                onClick={() => void onSaveSelection()}
              >
                {busy === 'save-selection' ? 'Saving…' : 'Save workspace selection'}
              </button>
            </div>
          </>
        ) : (
          <p style={{ fontSize: '0.9rem' }}>
            Connect OAuth first to load GTM accounts, or set <code>GTM_API_ENABLED=true</code> in
            backend/.env.
          </p>
        )}
      </section>

      <section style={{ marginTop: '1.25rem', opacity: canUseApi ? 1 : 0.55 }}>
        <h3>3. Read / write API tests</h3>
        <p style={{ fontSize: '0.85rem' }}>
          Read tests list accounts, containers, workspaces, tags, triggers, and variables. Write tests
          create a constant variable in the selected workspace (does not publish).
        </p>
        <div className="actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={
              !canUseApi ||
              !draftAccountId ||
              !draftContainerId ||
              !draftWorkspaceId ||
              busy !== null
            }
            onClick={() => void onRunTests('read')}
          >
            {busy === 'read-test' ? 'Running read tests…' : 'Run read tests'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={
              !canUseApi ||
              !draftAccountId ||
              !draftContainerId ||
              !draftWorkspaceId ||
              busy !== null
            }
            onClick={() => void onRunTests('write')}
          >
            {busy === 'write-test' ? 'Running write tests…' : 'Run write tests'}
          </button>
        </div>
      </section>

      {testResult ? (
        <>
          <p style={{ marginTop: '1rem' }}>
            {testResult.mode === 'read' ? 'Read' : 'Write'} tests — workspace ready:{' '}
            {testResult.workspaceReady ? 'yes' : 'no'} — {testResult.summary.passed}/
            {testResult.summary.total} passed
          </p>
          <StageLog
            stages={testResult.stages}
            title={`${testResult.mode === 'read' ? 'Read' : 'Write'} test log`}
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
