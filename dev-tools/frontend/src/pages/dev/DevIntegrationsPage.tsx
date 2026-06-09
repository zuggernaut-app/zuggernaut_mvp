import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ApiError } from '../../../../../frontend/src/api/client'
import {
  createSandboxBusiness,
  fetchDevGoogleConnectUrl,
  fetchDiagnosticRun,
  fetchDiagnosticsOverview,
  fetchGoogleAdsResourceOptions,
  fetchGtmResourceOptions,
  fetchProvisioningCheck,
  isDevIntegrationsEnabled,
  runGoogleAdsCreationDiagnostics,
  runGtmCreationDiagnostics,
  runProviderSmokeTest,
  saveGoogleAdsSelection,
  saveGtmSelection,
  startDevScrape,
  waitForDevScrapeCompletion,
  type CreationDiagnosticRunDetail,
  type CreationDiagnosticRunMode,
  type DiagnosticsOverviewResponse,
  type GoogleAdsResourceOptionsResult,
  type GtmResourceOptionsResult,
  type SmokeTestResult,
} from '../../api/dev/devIntegrations'
import type { ScrapeRunDto } from '../../../../../frontend/src/types/api'
import type { IntegrationProvider } from '../../../../../frontend/src/api/integrations'
import { ErrorAlert } from '../../../../../frontend/src/components/feedback/ErrorAlert'
import { InlineLoading } from '../../../../../frontend/src/components/feedback/InlineLoading'
import { PageLayout } from '../../../../../frontend/src/components/layout/PageLayout'
import { integrationStatusLabel } from '../../../../../frontend/src/lib/provisioningUi'

const PROVIDERS: IntegrationProvider[] = ['google_ads', 'gtm', 'gbp']

const PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  google_ads: 'Google Ads',
  gtm: 'Google Tag Manager',
  gbp: 'Google Business Profile',
}

export function DevIntegrationsPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams()
  const [businessId, setBusinessId] = useState<string | null>(null)
  const [overview, setOverview] = useState<DiagnosticsOverviewResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [smokeByProvider, setSmokeByProvider] = useState<
    Partial<Record<IntegrationProvider, SmokeTestResult>>
  >({})
  const [busyProvider, setBusyProvider] = useState<IntegrationProvider | null>(null)
  const [scrapeUrl, setScrapeUrl] = useState('https://example.com')
  const [scrapeBusy, setScrapeBusy] = useState(false)
  const [scrapeRun, setScrapeRun] = useState<ScrapeRunDto | null>(null)
  const [creationMode, setCreationMode] = useState<CreationDiagnosticRunMode>('create_paused')
  const [confirmCreateExternalResources, setConfirmCreateExternalResources] = useState(false)
  const [creationBusyProvider, setCreationBusyProvider] = useState<'google_ads' | 'gtm' | null>(
    null,
  )
  const [creationResult, setCreationResult] = useState<CreationDiagnosticRunDetail | null>(null)
  const [adsResources, setAdsResources] = useState<GoogleAdsResourceOptionsResult | null>(null)
  const [gtmResources, setGtmResources] = useState<GtmResourceOptionsResult | null>(null)
  const [draftAdsCustomerId, setDraftAdsCustomerId] = useState<string | null>(null)
  const [draftGtmSelection, setDraftGtmSelection] = useState<{
    accountId: string
    containerId: string
    workspaceId: string
  } | null>(null)
  const [selectionBusy, setSelectionBusy] = useState<'google_ads' | 'gtm' | null>(null)

  const loadResourceOptions = useCallback(async (bid: string, data: DiagnosticsOverviewResponse) => {
    const tasks: Promise<void>[] = []

    const adsStatus = data.connections.google_ads
    if (
      adsStatus &&
      adsStatus.reason !== 'missing_connection' &&
      adsStatus.reason !== 'not_connected'
    ) {
      tasks.push(
        fetchGoogleAdsResourceOptions(bid)
          .then(({ result }) => {
            setAdsResources(result)
            setDraftAdsCustomerId(
              result.selected?.customerId ??
                result.suggestedCustomerId ??
                result.options.find((row) => row.selectable)?.customerId ??
                null,
            )
          })
          .catch(() => setAdsResources(null)),
      )
    } else {
      setAdsResources(null)
      setDraftAdsCustomerId(null)
    }

    const gtmStatus = data.connections.gtm
    if (
      gtmStatus &&
      gtmStatus.reason !== 'missing_connection' &&
      gtmStatus.reason !== 'not_connected'
    ) {
      tasks.push(
        fetchGtmResourceOptions(bid)
          .then(({ result }) => {
            setGtmResources(result)
            if (result.selected) {
              setDraftGtmSelection({
                accountId: result.selected.accountId,
                containerId: result.selected.containerId,
                workspaceId: result.selected.workspaceId,
              })
            } else {
              const account = result.accounts[0]
              const container = account?.containers[0]
              const workspace = container?.workspaces[0]
              setDraftGtmSelection(
                account && container && workspace
                  ? {
                      accountId: account.accountId,
                      containerId: container.containerId,
                      workspaceId: workspace.workspaceId,
                    }
                  : null,
              )
            }
          })
          .catch(() => setGtmResources(null)),
      )
    } else {
      setGtmResources(null)
      setDraftGtmSelection(null)
    }

    await Promise.all(tasks)
  }, [])

  const loadOverview = useCallback(
    async (bid: string) => {
      setError(null)
      const data = await fetchDiagnosticsOverview(bid)
      setOverview(data)
      await loadResourceOptions(bid, data)
    },
    [loadResourceOptions],
  )

  const bootstrap = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const urlBusinessId = searchParams.get('businessId')?.trim()
      if (urlBusinessId) {
        setBusinessId(urlBusinessId)
        await loadOverview(urlBusinessId)
        return
      }

      const sandbox = await createSandboxBusiness()
      setBusinessId(sandbox.businessId)
      await loadOverview(sandbox.businessId)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError(
          'Integration diagnostics API returned 404. Set ENABLE_INTEGRATION_DIAGNOSTICS=true in backend/.env (not VITE_*), then restart the backend (npm start).',
        )
      } else if (err instanceof ApiError && err.status === 401) {
        setError('Log in first, then open /dev/integrations again.')
      } else {
        setError(err instanceof ApiError ? err.message : 'Failed to load diagnostics.')
      }
    } finally {
      setLoading(false)
    }
  }, [loadOverview, searchParams])

  useEffect(() => {
    void bootstrap()
  }, [bootstrap])

  useEffect(() => {
    const integration = searchParams.get('integration')
    const provider = searchParams.get('provider')
    const reason = searchParams.get('reason')
    if (!integration) return

    if (integration === 'connected' && provider) {
      setNotice(
        provider === 'google_ads' || provider === 'gtm'
          ? `${provider} connected. Select the target account below before running creation diagnostics.`
          : `${provider} connected successfully.`,
      )
      if (businessId) void loadOverview(businessId)
    } else if (integration === 'error') {
      setNotice(reason ? `Connection failed (${reason}).` : 'Connection failed.')
    }

    const next = new URLSearchParams(searchParams)
    next.delete('integration')
    next.delete('provider')
    next.delete('reason')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams, businessId, loadOverview])

  async function onConnect(provider: IntegrationProvider): Promise<void> {
    if (!businessId) return
    setBusyProvider(provider)
    setError(null)
    try {
      const res = await fetchDevGoogleConnectUrl(provider, businessId)
      window.location.assign(res.url)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start OAuth.')
      setBusyProvider(null)
    }
  }

  async function onSmokeTest(provider: IntegrationProvider): Promise<void> {
    if (!businessId) return
    setBusyProvider(provider)
    setError(null)
    try {
      const { result } = await runProviderSmokeTest(provider, businessId)
      setSmokeByProvider((prev) => ({ ...prev, [provider]: result }))
      await loadOverview(businessId)
    } catch (err) {
      if (err instanceof ApiError && err.body && typeof err.body === 'object') {
        const body = err.body as { result?: SmokeTestResult }
        if (body.result) {
          setSmokeByProvider((prev) => ({ ...prev, [provider]: body.result }))
        }
      }
      setError(err instanceof ApiError ? err.message : 'Smoke test failed.')
    } finally {
      setBusyProvider(null)
    }
  }

  async function onScrapeWebsite(): Promise<void> {
    if (!businessId) return
    setScrapeBusy(true)
    setError(null)
    setScrapeRun(null)
    try {
      const started = await startDevScrape(businessId, scrapeUrl.trim())
      setScrapeRun({
        id: started.scrapeRunId,
        businessId: started.businessId,
        websiteUrl: started.websiteUrl,
        temporalWorkflowId: started.workflowId,
        status: started.status,
        lastErrorSummary: null,
        suggested: null,
      })
      const finished = await waitForDevScrapeCompletion(businessId, started.scrapeRunId)
      setScrapeRun(finished)
      if (finished.status === 'FAILED') {
        setError(finished.lastErrorSummary ?? 'Scrape failed.')
      } else if (!finished.suggested) {
        setNotice(`Scrape finished (${finished.status}) but returned no suggestions.`)
      } else {
        setNotice(`Scrape finished (${finished.status}).`)
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError(
          'Scrape API returned 404. Restart the backend (`npm start` in backend/) so new routes load, then try again.',
        )
      } else if (err instanceof ApiError && err.status === 401) {
        setError('Log in first, then run the scrape again.')
      } else {
        setError(err instanceof ApiError ? err.message : 'Scrape failed.')
      }
    } finally {
      setScrapeBusy(false)
    }
  }

  function isCreationDiagnosticsReady(provider: 'google_ads' | 'gtm'): boolean {
    return overview?.connections[provider]?.ready === true
  }

  async function onSaveGoogleAdsSelection(): Promise<void> {
    if (!businessId || !draftAdsCustomerId) return
    setSelectionBusy('google_ads')
    setError(null)
    try {
      await saveGoogleAdsSelection(businessId, draftAdsCustomerId)
      await loadOverview(businessId)
      setNotice('Google Ads customer selected for diagnostics.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save Google Ads selection.')
    } finally {
      setSelectionBusy(null)
    }
  }

  async function onSaveGtmSelection(): Promise<void> {
    if (!businessId || !draftGtmSelection) return
    setSelectionBusy('gtm')
    setError(null)
    try {
      await saveGtmSelection(businessId, draftGtmSelection)
      await loadOverview(businessId)
      setNotice('GTM container and workspace selected for diagnostics.')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save GTM selection.')
    } finally {
      setSelectionBusy(null)
    }
  }

  async function onRunCreationDiagnostics(provider: 'google_ads' | 'gtm'): Promise<void> {
    if (!businessId) return
    if (!isCreationDiagnosticsReady(provider)) {
      setError(
        provider === 'google_ads'
          ? 'Select a Google Ads customer account below before running creation diagnostics.'
          : 'Select a GTM account, container, and workspace below before running creation diagnostics.',
      )
      return
    }
    if (!confirmCreateExternalResources) {
      setError('Check the confirmation box before creating external test resources.')
      return
    }

    setCreationBusyProvider(provider)
    setError(null)
    setCreationResult(null)

    try {
      const mode =
        provider === 'google_ads' && creationMode === 'create_and_publish'
          ? 'create_paused'
          : creationMode

      const { result } =
        provider === 'gtm'
          ? await runGtmCreationDiagnostics(businessId, mode, confirmCreateExternalResources)
          : await runGoogleAdsCreationDiagnostics(
              businessId,
              mode,
              confirmCreateExternalResources,
            )

      const detail = await fetchDiagnosticRun(businessId, result.diagnosticRunId)
      setCreationResult(detail.result)
      if (!detail.result.ok) {
        setError(detail.result.message)
      } else {
        setNotice(`${PROVIDER_LABELS[provider]} creation diagnostics completed.`)
      }
    } catch (err) {
      if (err instanceof ApiError && err.body && typeof err.body === 'object') {
        const body = err.body as { result?: CreationDiagnosticRunDetail }
        if (body.result) {
          setCreationResult(body.result)
        }
      }
      if (err instanceof ApiError && err.status === 404) {
        setError(
          'Creation diagnostics API returned 404. Restart the backend (`npm start` in backend/) and confirm ENABLE_INTEGRATION_DIAGNOSTICS=true in backend/.env.',
        )
      } else if (err instanceof ApiError && err.status === 409) {
        setError(
          err.message ||
            'Provider account selection is required before creation diagnostics can run.',
        )
      } else {
        setError(err instanceof ApiError ? err.message : 'Creation diagnostics failed.')
      }
    } finally {
      setCreationBusyProvider(null)
    }
  }

  async function onProvisioningCheck(provider: 'gtm' | 'google_ads'): Promise<void> {
    if (!businessId) return
    setBusyProvider(provider)
    setError(null)
    try {
      const check = await fetchProvisioningCheck(provider, businessId)
      setNotice(
        `${provider} provisioning required: ${check.provisioningRequired ? 'yes' : 'no'}`,
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Provisioning check failed.')
    } finally {
      setBusyProvider(null)
    }
  }

  if (!isDevIntegrationsEnabled()) {
    return (
      <PageLayout title="Integration diagnostics">
        <p>Dev integration diagnostics are disabled. Set VITE_ENABLE_INTEGRATION_DIAGNOSTICS=true in development.</p>
      </PageLayout>
    )
  }

  if (loading && !overview) {
    return (
      <PageLayout title="Integration diagnostics">
        <InlineLoading label="Preparing sandbox business…" />
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="Integration diagnostics"
      lead="Dev-only: test Google OAuth, discovery, and read-only API smoke tests without full onboarding."
    >
      <ErrorAlert message={error} />
      {notice ? (
        <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
          {notice}
        </div>
      ) : null}

      <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>
        Sandbox business:{' '}
        <code style={{ wordBreak: 'break-all' }}>{businessId ?? '—'}</code>
      </p>
      {businessId ? (
        <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginTop: '0.35rem' }}>
          CLI trace (same checks as this page):{' '}
          <code style={{ wordBreak: 'break-all' }}>
            npm run debug:dev-integrations-flow -- {businessId}
          </code>
        </p>
      ) : null}
      <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginTop: '0.35rem' }}>
        Google Ads test developer tokens only mutate test accounts. Set{' '}
        <code>GOOGLE_ADS_LOGIN_CUSTOMER_ID</code> to your MCC (e.g. 346-219-8684), then select a
        test client account (e.g. 536-918-3891) after OAuth. Optional:{' '}
        <code>GOOGLE_ADS_PREFERRED_TEST_CUSTOMER_ID=5369183891</code> in backend/.env.
      </p>
      {businessId ? (
        <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginTop: '0.35rem' }}>
          Focused OAuth labs:{' '}
          <Link to={`/dev/integrations/googleads?businessId=${businessId}`}>
            Google Ads
          </Link>
          {' · '}
          <Link to={`/dev/integrations/gtm?businessId=${businessId}`}>GTM</Link>
          {' · '}
          <Link to={`/dev/integrations/gbp?businessId=${businessId}`}>GBP</Link>
        </p>
      ) : null}

      <section style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>Website scrape</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', marginBottom: '0.75rem' }}>
          Test the Temporal scrape workflow on the sandbox business without onboarding.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
          <input
            type="url"
            className="input"
            style={{ minWidth: '16rem', flex: '1 1 16rem' }}
            value={scrapeUrl}
            onChange={(e) => setScrapeUrl(e.target.value)}
            placeholder="https://example.com"
            disabled={scrapeBusy || !businessId}
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={scrapeBusy || !businessId || !scrapeUrl.trim()}
            onClick={() => void onScrapeWebsite()}
          >
            {scrapeBusy ? 'Scraping…' : 'Scrape website'}
          </button>
        </div>
        {scrapeRun ? (
          <pre
            style={{
              fontSize: '0.75rem',
              marginTop: '0.75rem',
              padding: '0.5rem',
              background: 'var(--color-surface-alt, #f4f4f5)',
              overflow: 'auto',
            }}
          >
            {JSON.stringify(scrapeRun, null, 2)}
          </pre>
        ) : null}
      </section>

      {overview?.environment ? (
        <section style={{ marginBottom: '1.5rem', fontSize: '0.85rem' }}>
          <h2 style={{ fontSize: '1rem' }}>Environment</h2>
          <ul className="stepsList">
            <li>OAuth mock: {overview.environment.googleOAuthMock ? 'yes' : 'no'}</li>
            <li>GTM mock: {overview.environment.gtmApiMock ? 'yes' : 'no'}</li>
            <li>Ads mock: {overview.environment.googleAdsApiMock ? 'yes' : 'no'}</li>
            <li>
              Ads API version: {overview.environment.googleAdsApiVersion ?? 'v24'}
            </li>
            <li>GBP mock: {overview.environment.gbpApiMock ? 'yes' : 'no'}</li>
          </ul>
        </section>
      ) : null}

      <section style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>External creation diagnostics</h2>
        <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', marginBottom: '0.75rem' }}>
          This creates real test resources in your connected Google account. Google Ads resources
          are paused by default. GTM publish requires explicit mode selection.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem', alignItems: 'center' }}>
          <label style={{ fontSize: '0.85rem' }}>
            Mode{' '}
            <select
              className="input"
              value={creationMode}
              onChange={(e) => setCreationMode(e.target.value as CreationDiagnosticRunMode)}
              disabled={creationBusyProvider !== null}
            >
              <option value="validate_only">Validate only</option>
              <option value="create_paused">Create paused</option>
              <option value="create_and_publish">Create and publish (GTM only)</option>
            </select>
          </label>
          <label style={{ fontSize: '0.85rem', display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={confirmCreateExternalResources}
              onChange={(e) => setConfirmCreateExternalResources(e.target.checked)}
              disabled={creationBusyProvider !== null}
            />
            I understand this creates real external test resources
          </label>
        </div>
        <div className="actions" style={{ marginTop: '0.75rem' }}>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={
              creationBusyProvider !== null ||
              !businessId ||
              !isCreationDiagnosticsReady('google_ads')
            }
            onClick={() => void onRunCreationDiagnostics('google_ads')}
          >
            {creationBusyProvider === 'google_ads'
              ? 'Running Google Ads…'
              : 'Run Google Ads creation diagnostic'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={
              creationBusyProvider !== null || !businessId || !isCreationDiagnosticsReady('gtm')
            }
            onClick={() => void onRunCreationDiagnostics('gtm')}
          >
            {creationBusyProvider === 'gtm'
              ? 'Running GTM…'
              : 'Run GTM creation diagnostic'}
          </button>
        </div>
        {creationResult ? (
          <div style={{ marginTop: '0.75rem' }}>
            <p style={{ fontSize: '0.85rem' }}>
              Run <code>{creationResult.diagnosticRunId}</code> —{' '}
              {creationResult.ok ? 'passed' : 'failed'} ({creationResult.summary.passed} passed,{' '}
              {creationResult.summary.skipped} skipped, {creationResult.summary.failed} failed)
            </p>
            <ul className="stepsList" style={{ fontSize: '0.8rem' }}>
              {creationResult.steps.map((step) => (
                <li key={step.name}>
                  <strong>{step.name}</strong> — {step.skipped ? 'skipped' : step.ok ? 'ok' : 'failed'}
                  {step.resourceId ? (
                    <>
                      {' '}
                      (<code>{step.resourceId}</code>)
                    </>
                  ) : null}
                  <div style={{ color: 'var(--color-muted)' }}>{step.message}</div>
                </li>
              ))}
            </ul>
            {creationResult.artifacts?.length ? (
              <pre
                style={{
                  fontSize: '0.75rem',
                  marginTop: '0.5rem',
                  padding: '0.5rem',
                  background: 'var(--color-surface-alt, #f4f4f5)',
                  overflow: 'auto',
                }}
              >
                {JSON.stringify(creationResult.artifacts, null, 2)}
              </pre>
            ) : null}
          </div>
        ) : null}
      </section>

      <section>
        <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Providers</h2>
        <ul className="stepsList">
          {PROVIDERS.map((provider) => {
            const status = overview?.connections[provider]
            const smoke = smokeByProvider[provider]
            const busy = busyProvider === provider
            return (
              <li key={provider} style={{ marginBottom: '1rem' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                  <strong>{PROVIDER_LABELS[provider]}</strong>
                  {status ? (
                    <span
                      className={`statusPill ${status.ready ? 'status-succeeded' : 'status-review'}`}
                    >
                      {integrationStatusLabel(status)}
                    </span>
                  ) : (
                    <span className="statusPill status-review">Unknown</span>
                  )}
                </div>
                {status?.reason === 'missing_connection' ? (
                  <p style={{ fontSize: '0.8rem', margin: '0.35rem 0', color: 'var(--color-muted)' }}>
                    Click Connect (OAuth) to grant {PROVIDER_LABELS[provider]} permissions for this
                    sandbox business.
                  </p>
                ) : null}
                {status?.reason === 'selection_required' ? (
                  <p style={{ fontSize: '0.8rem', margin: '0.35rem 0', color: 'var(--color-muted)' }}>
                    OAuth succeeded. Pick the target account below — cancelled and manager accounts
                    are shown but cannot be used for creation diagnostics.
                  </p>
                ) : null}
                {provider === 'google_ads' && adsResources ? (
                  <div style={{ marginTop: '0.5rem' }}>
                    <h3 style={{ fontSize: '0.9rem', marginBottom: '0.35rem' }}>
                      Google Ads account selection
                    </h3>
                    {adsResources.options.length === 0 ? (
                      <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
                        No accessible Google Ads customers found.
                      </p>
                    ) : (
                      <ul className="stepsList" style={{ fontSize: '0.8rem' }}>
                        {adsResources.options.map((option) => (
                          <li key={option.customerId}>
                            <label style={{ display: 'flex', gap: '0.35rem', alignItems: 'flex-start' }}>
                              <input
                                type="radio"
                                name="google-ads-customer"
                                disabled={!option.selectable || selectionBusy !== null}
                                checked={draftAdsCustomerId === option.customerId}
                                onChange={() => setDraftAdsCustomerId(option.customerId)}
                              />
                              <span>
                                <strong>
                                  {option.descriptiveName ?? 'Google Ads account'}{' '}
                                  {option.formattedCustomerId
                                    ? `(${option.formattedCustomerId})`
                                    : ''}
                                </strong>
                                {option.kind === 'manager' ? ' — Manager' : null}
                                {option.status === 'cancelled' ? ' — Cancelled' : null}
                                {!option.selectable && option.nonSelectableReason ? (
                                  <div style={{ color: 'var(--color-muted)' }}>
                                    {option.nonSelectableReason}
                                  </div>
                                ) : null}
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ marginTop: '0.5rem' }}
                      disabled={
                        selectionBusy !== null ||
                        !draftAdsCustomerId ||
                        !adsResources.options.find(
                          (row) => row.customerId === draftAdsCustomerId && row.selectable,
                        )
                      }
                      onClick={() => void onSaveGoogleAdsSelection()}
                    >
                      {selectionBusy === 'google_ads' ? 'Saving…' : 'Save Google Ads selection'}
                    </button>
                    {adsResources.selected ? (
                      <p style={{ fontSize: '0.8rem', marginTop: '0.35rem', color: 'var(--color-muted)' }}>
                        Selected: {adsResources.selected.descriptiveName ?? 'Account'}{' '}
                        ({adsResources.selected.formattedCustomerId})
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {provider === 'gtm' && gtmResources ? (
                  <div style={{ marginTop: '0.5rem' }}>
                    <h3 style={{ fontSize: '0.9rem', marginBottom: '0.35rem' }}>
                      GTM resource selection
                    </h3>
                    {gtmResources.accounts.length === 0 ? (
                      <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>
                        No accessible GTM accounts found.
                      </p>
                    ) : (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                        <label style={{ fontSize: '0.8rem' }}>
                          Account{' '}
                          <select
                            className="input"
                            value={draftGtmSelection?.accountId ?? ''}
                            disabled={selectionBusy !== null}
                            onChange={(e) => {
                              const accountId = e.target.value
                              const account = gtmResources.accounts.find(
                                (row) => row.accountId === accountId,
                              )
                              const container = account?.containers[0]
                              const workspace = container?.workspaces[0]
                              setDraftGtmSelection(
                                account && container && workspace
                                  ? {
                                      accountId,
                                      containerId: container.containerId,
                                      workspaceId: workspace.workspaceId,
                                    }
                                  : null,
                              )
                            }}
                          >
                            <option value="">Select account</option>
                            {gtmResources.accounts.map((account) => (
                              <option key={account.accountId} value={account.accountId}>
                                {account.name ?? account.accountId}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label style={{ fontSize: '0.8rem' }}>
                          Container{' '}
                          <select
                            className="input"
                            value={draftGtmSelection?.containerId ?? ''}
                            disabled={selectionBusy !== null || !draftGtmSelection?.accountId}
                            onChange={(e) => {
                              const containerId = e.target.value
                              const account = gtmResources.accounts.find(
                                (row) => row.accountId === draftGtmSelection?.accountId,
                              )
                              const container = account?.containers.find(
                                (row) => row.containerId === containerId,
                              )
                              const workspace = container?.workspaces[0]
                              if (!account || !container || !workspace) {
                                setDraftGtmSelection(null)
                                return
                              }
                              setDraftGtmSelection({
                                accountId: account.accountId,
                                containerId,
                                workspaceId: workspace.workspaceId,
                              })
                            }}
                          >
                            <option value="">Select container</option>
                            {(gtmResources.accounts.find(
                              (row) => row.accountId === draftGtmSelection?.accountId,
                            )?.containers ?? []
                            ).map((container) => (
                              <option key={container.containerId} value={container.containerId}>
                                {container.publicContainerId ?? container.name ?? container.containerId}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label style={{ fontSize: '0.8rem' }}>
                          Workspace{' '}
                          <select
                            className="input"
                            value={draftGtmSelection?.workspaceId ?? ''}
                            disabled={selectionBusy !== null || !draftGtmSelection?.containerId}
                            onChange={(e) => {
                              const workspaceId = e.target.value
                              if (!draftGtmSelection) return
                              setDraftGtmSelection({ ...draftGtmSelection, workspaceId })
                            }}
                          >
                            <option value="">Select workspace</option>
                            {(
                              gtmResources.accounts
                                .find((row) => row.accountId === draftGtmSelection?.accountId)
                                ?.containers.find(
                                  (row) => row.containerId === draftGtmSelection?.containerId,
                                )?.workspaces ?? []
                            ).map((workspace) => (
                              <option key={workspace.workspaceId} value={workspace.workspaceId}>
                                {workspace.name ?? workspace.workspaceId}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    )}
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ marginTop: '0.5rem' }}
                      disabled={selectionBusy !== null || !draftGtmSelection?.workspaceId}
                      onClick={() => void onSaveGtmSelection()}
                    >
                      {selectionBusy === 'gtm' ? 'Saving…' : 'Save GTM selection'}
                    </button>
                    {gtmResources.selected ? (
                      <p style={{ fontSize: '0.8rem', marginTop: '0.35rem', color: 'var(--color-muted)' }}>
                        Selected: {gtmResources.selected.publicContainerId ?? gtmResources.selected.containerId}{' '}
                        / workspace {gtmResources.selected.workspaceName ?? gtmResources.selected.workspaceId}
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {status?.reason === 'insufficient_scopes' && status.scopesMissing?.length ? (
                  <p style={{ fontSize: '0.8rem', margin: '0.35rem 0' }}>
                    Missing scopes: {status.scopesMissing.join(', ')}. Click Connect (OAuth) again and
                    approve all requested permissions.
                  </p>
                ) : null}
                {status?.providerIdentifiers ? (
                  <pre
                    style={{
                      fontSize: '0.75rem',
                      margin: '0.35rem 0',
                      padding: '0.5rem',
                      background: 'var(--color-surface-alt, #f4f4f5)',
                      overflow: 'auto',
                    }}
                  >
                    {JSON.stringify(status.providerIdentifiers, null, 2)}
                  </pre>
                ) : null}
                <div className="actions" style={{ marginTop: '0.5rem' }}>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy || !businessId}
                    onClick={() => void onConnect(provider)}
                  >
                    {busy ? '…' : 'Connect (OAuth)'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busy || !businessId}
                    onClick={() => void onSmokeTest(provider)}
                  >
                    Smoke test (read-only)
                  </button>
                  {provider === 'gtm' || provider === 'google_ads' ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={busy || !businessId}
                      onClick={() => void onProvisioningCheck(provider)}
                    >
                      Provisioning check
                    </button>
                  ) : null}
                </div>
                {smoke ? (
                  <pre
                    style={{
                      fontSize: '0.75rem',
                      marginTop: '0.5rem',
                      padding: '0.5rem',
                      background: smoke.ok ? '#ecfdf5' : '#fef2f2',
                    }}
                  >
                    {JSON.stringify(smoke, null, 2)}
                  </pre>
                ) : null}
              </li>
            )
          })}
        </ul>
      </section>

      <div className="actions">
        <button type="button" className="btn btn-secondary" onClick={() => void bootstrap()}>
          Reset sandbox &amp; refresh
        </button>
      </div>
    </PageLayout>
  )
}
