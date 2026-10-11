import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactElement } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { getBusinessContext, updateBusinessContext } from '../api/businessContexts'
import {
  checkBusinessSetupSnippet,
  confirmBusinessSetupFacts,
  pollBusinessSetupTrackingTest,
  skipBusinessSetupGbp,
  startBusinessSetupTrackingTest,
  type SnippetCheckResult,
} from '../api/businessSetup'
import {
  createProvisioningRequest,
  fetchGoogleConnectUrl,
  fetchIntegrationStatus,
  fetchProvisioningOverview,
} from '../api/integrations'
import {
  enableLeadCampaignSlot,
  getLeadCampaignDashboard,
  type LeadCampaignDashboardResponse,
  type LeadCampaignSlotName,
} from '../api/leadCampaigns'
import { GoogleAdsCustomerSelector } from '../components/integrations/GoogleAdsCustomerSelector'
import { GtmResourceSelector } from '../components/integrations/GtmResourceSelector'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import { useAuth } from '../hooks/useAuth'
import { useOnboardingState } from '../hooks/useOnboardingState'
import {
  INTEGRATION_PROVIDERS,
  useIntegrationConnections,
} from '../hooks/useIntegrationConnections'
import {
  allTrackingGoalsPass,
  bothDraftsApproved,
  isStep2Complete,
  isStep3ObjectiveComplete,
  readPrimaryGoal,
  step1PendingItems,
  trackingGoalLabel,
} from '../lib/businessSetupUi'
import type { BusinessContextDto, BusinessContextUpdateBody } from '../types/api'
import type { IntegrationProvider } from '../api/integrations'

type AccountCurrency = 'USD' | 'INR'

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function readPhone(contactMethods: unknown): string {
  if (!contactMethods || typeof contactMethods !== 'object') return ''
  const cm = contactMethods as { phones?: string[]; phone?: string }
  if (Array.isArray(cm.phones) && cm.phones[0]) return cm.phones[0]
  if (typeof cm.phone === 'string') return cm.phone
  return ''
}

function draftStatusLabel(status: string | undefined): string {
  if (status === 'approved') return 'Approved'
  return 'Awaiting operator review'
}

function snippetCheckDisplayLabel(
  status: SnippetCheckResult['status'] | null,
  errorMessage: string | null,
): string | null {
  if (!status) return null
  if (status === 'on_site') return 'On the site'
  if (status === 'not_on_site') return 'Not on the site'
  return errorMessage ?? 'Could not check snippet'
}

export function BusinessSetupPage(): ReactElement {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()
  const { snapshot, setBusinessId } = useOnboardingState()
  const queryBusinessId = searchParams.get('businessId')
  const businessId =
    user?.platformAdmin && queryBusinessId ? queryBusinessId : snapshot.businessId

  const returnPath = businessId
    ? `/business-setup?businessId=${encodeURIComponent(businessId)}`
    : '/business-setup'

  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [context, setContext] = useState<BusinessContextDto | null>(null)
  const [dashboard, setDashboard] = useState<LeadCampaignDashboardResponse | null>(null)
  const [currencyCode, setCurrencyCode] = useState<AccountCurrency>('USD')
  const [currencyBusy, setCurrencyBusy] = useState(false)
  const [snippetBusy, setSnippetBusy] = useState(false)
  const [snippetStatus, setSnippetStatus] = useState<SnippetCheckResult['status'] | null>(null)
  const [snippetErrorMessage, setSnippetErrorMessage] = useState<string | null>(null)
  const [gbpSkipped, setGbpSkipped] = useState(false)
  const [factBusy, setFactBusy] = useState(false)
  const [strategyBusy, setStrategyBusy] = useState(false)
  const [trackingStartedAt, setTrackingStartedAt] = useState<string | null>(null)
  const [trackingGoals, setTrackingGoals] = useState<Record<string, string>>({})
  const [trackingBusy, setTrackingBusy] = useState(false)
  const [runBusy, setRunBusy] = useState<LeadCampaignSlotName | null>(null)

  const [factForm, setFactForm] = useState({
    services: '',
    whoBuysToday: '',
    serviceAreas: '',
    orderValueHint: '',
    howBuyersContact: '',
  })

  const [strategyForm, setStrategyForm] = useState({
    uvp: '',
    businessScope: '' as BusinessContextDto['businessScope'] | '',
    valueComplexity: '' as BusinessContextDto['valueComplexity'] | '',
    budgetTier: '' as BusinessContextDto['budgetTier'] | '',
    services: '',
  })

  const {
    connections,
    loading: connectionsLoading,
    error: connectionsError,
    refetch: refetchConnections,
    connectProvider,
    providerLabels,
    statusLabel,
  } = useIntegrationConnections(businessId ?? null)

  const loadContext = useCallback(async () => {
    if (!businessId) return
    const res = await getBusinessContext(businessId)
    setContext(res.businessContext)
    setFactForm({
      services: (res.businessContext.services ?? []).join('\n'),
      whoBuysToday: res.businessContext.whoBuysToday ?? '',
      serviceAreas: (res.businessContext.serviceAreas ?? []).join('\n'),
      orderValueHint: res.businessContext.orderValueHint ?? '',
      howBuyersContact: res.businessContext.howBuyersContact ?? '',
    })
    setStrategyForm({
      uvp: res.businessContext.uvp ?? '',
      businessScope: res.businessContext.businessScope ?? '',
      valueComplexity: res.businessContext.valueComplexity ?? '',
      budgetTier: res.businessContext.budgetTier ?? '',
      services: (res.businessContext.services ?? []).join('\n'),
    })
    if (!res.businessContext.confirmedAt) {
      navigate('/onboarding/business', { replace: true })
    }
  }, [businessId, navigate])

  const loadDashboard = useCallback(async () => {
    if (!businessId) return
    try {
      const data = await getLeadCampaignDashboard(businessId)
      setDashboard(data)
    } catch {
      setDashboard(null)
    }
  }, [businessId])

  useEffect(() => {
    if (!businessId) {
      navigate('/onboarding/business', { replace: true })
      return
    }
    if (!user?.platformAdmin || !queryBusinessId) {
      setBusinessId(businessId)
    }
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        await loadContext()
        await loadDashboard()
        const [statusRes, provisioningRes] = await Promise.all([
          fetchIntegrationStatus(businessId),
          fetchProvisioningOverview(businessId),
        ])
        if (cancelled) return
        const request =
          provisioningRes.providers.google_ads.activeRequest ??
          provisioningRes.providers.google_ads.latestRequest
        if (request?.currencyCode === 'USD' || request?.currencyCode === 'INR') {
          setCurrencyCode(request.currencyCode)
        }
        const gbp = statusRes.connections.gbp
        setGbpSkipped(!gbp?.ready)
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Could not load business setup.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [businessId, loadContext, loadDashboard, navigate, queryBusinessId, setBusinessId, user?.platformAdmin])

  const primaryGoal = readPrimaryGoal(context?.goals)
  const step1Pending = step1PendingItems(connections).filter(
    (item) => !gbpSkipped || !item.includes('Google Business Profile'),
  )
  const step2Done = isStep2Complete(context)
  const step3Done = isStep3ObjectiveComplete(context)
  const draftsApproved = bothDraftsApproved(
    dashboard?.slots ?? { recommended: null, alternative: null },
  )
  const trackingPass = allTrackingGoalsPass(trackingGoals, primaryGoal)

  const canRun =
    step1Pending.length === 0 &&
    step2Done &&
    step3Done &&
    draftsApproved &&
    trackingPass &&
    snippetStatus === 'on_site'

  const runDisabledReason = useMemo(() => {
    if (!draftsApproved) return 'Campaigns pending review'
    if (!trackingPass) return 'Complete tracking test'
    if (snippetStatus !== 'on_site') return 'Install GTM on your site'
    if (!step2Done || !step3Done) return 'Finish earlier steps'
    return null
  }, [draftsApproved, trackingPass, snippetStatus, step2Done, step3Done])

  async function onSaveCurrency(): Promise<void> {
    if (!businessId) return
    setCurrencyBusy(true)
    setError(null)
    try {
      await createProvisioningRequest('google_ads', { businessId, currencyCode })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save currency.')
    } finally {
      setCurrencyBusy(false)
    }
  }

  async function onReconnect(provider: IntegrationProvider): Promise<void> {
    if (!businessId) return
    try {
      const res = await fetchGoogleConnectUrl(provider, businessId, returnPath)
      window.location.assign(res.url)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start connection.')
    }
  }

  async function onCheckSnippet(): Promise<void> {
    if (!businessId) return
    setSnippetBusy(true)
    setError(null)
    try {
      const res = await checkBusinessSetupSnippet(businessId)
      setSnippetStatus(res.status)
      setSnippetErrorMessage(res.status === 'error' ? (res.message ?? 'Could not check snippet') : null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Snippet check failed.')
    } finally {
      setSnippetBusy(false)
    }
  }

  async function onSkipGbp(): Promise<void> {
    if (!businessId) return
    setError(null)
    try {
      await skipBusinessSetupGbp(businessId)
      setGbpSkipped(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record GBP skip.')
    }
  }

  async function onConfirmFacts(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!businessId) return
    setFactBusy(true)
    setError(null)
    try {
      const res = await confirmBusinessSetupFacts(businessId, {
        services: splitLines(factForm.services),
        whoBuysToday: factForm.whoBuysToday.trim(),
        serviceAreas: splitLines(factForm.serviceAreas),
        orderValueHint: factForm.orderValueHint.trim(),
        howBuyersContact: factForm.howBuyersContact.trim(),
      })
      setContext((prev) =>
        prev
          ? {
              ...prev,
              factCheckCompletedAt: res.factCheckCompletedAt,
              services: splitLines(factForm.services),
              whoBuysToday: factForm.whoBuysToday.trim() || null,
              serviceAreas: splitLines(factForm.serviceAreas),
              orderValueHint: factForm.orderValueHint.trim() || null,
              howBuyersContact: factForm.howBuyersContact.trim() || null,
            }
          : prev,
      )
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not confirm facts.')
    } finally {
      setFactBusy(false)
    }
  }

  async function onSaveStrategy(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!businessId || !strategyForm.uvp.trim()) return
    if (!strategyForm.businessScope || !strategyForm.valueComplexity || !strategyForm.budgetTier) {
      setError('UVP, scope, value×complexity, and budget tier are required.')
      return
    }
    setStrategyBusy(true)
    setError(null)
    try {
      const body: BusinessContextUpdateBody = {
        services: splitLines(strategyForm.services),
        uvp: strategyForm.uvp.trim(),
        businessScope: strategyForm.businessScope,
        valueComplexity: strategyForm.valueComplexity,
        budgetTier: strategyForm.budgetTier,
      }
      const saved = await updateBusinessContext(businessId, body)
      setContext(saved.businessContext)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save campaign objectives.')
    } finally {
      setStrategyBusy(false)
    }
  }

  async function onStartTrackingTest(): Promise<void> {
    if (!businessId) return
    setTrackingBusy(true)
    setError(null)
    try {
      const res = await startBusinessSetupTrackingTest(businessId)
      setTrackingStartedAt(res.trackingTestStartedAt)
      setTrackingGoals({})
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start tracking test.')
    } finally {
      setTrackingBusy(false)
    }
  }

  async function onPollTracking(): Promise<void> {
    if (!businessId) return
    setTrackingBusy(true)
    setError(null)
    try {
      const res = await pollBusinessSetupTrackingTest(businessId)
      setTrackingGoals(res.goals)
      setTrackingStartedAt(res.trackingTestStartedAt)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not check tracking.')
    } finally {
      setTrackingBusy(false)
    }
  }

  async function onRunSlot(slot: LeadCampaignSlotName): Promise<void> {
    if (!businessId || !canRun) return
    setRunBusy(slot)
    setError(null)
    try {
      await enableLeadCampaignSlot(businessId, slot)
      await loadDashboard()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not start campaign.')
    } finally {
      setRunBusy(null)
    }
  }

  if (!businessId || loading) {
    return (
      <PageLayout title="Business setup">
        <InlineLoading label="Loading business setup…" />
      </PageLayout>
    )
  }

  const gtmStatus = connections.gtm
  const publicContainerId =
    typeof gtmStatus?.providerIdentifiers?.publicContainerId === 'string'
      ? gtmStatus.providerIdentifiers.publicContainerId
      : null

  return (
    <PageLayout
      title="Business setup"
      lead="Four steps before your campaigns can run."
    >
      <div className="actions" style={{ marginBottom: '1rem' }}>
        <Link className="btn btn-secondary" to="/">
          Back to home
        </Link>
      </div>
      <ErrorAlert message={error ?? connectionsError} />

      <nav className="actions" style={{ marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            type="button"
            className={step === n ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => setStep(n)}
          >
            Step {n}
          </button>
        ))}
      </nav>

      {step === 1 ? (
        <section>
          <h2>Step 1 — Accounts &amp; site</h2>
          <p style={{ color: 'var(--color-muted)' }}>
            Connect Google Ads and Tag Manager, choose account currency, and confirm the GTM snippet is
            on your website.
          </p>
          {connectionsLoading ? <InlineLoading label="Loading connections…" /> : null}
          <div style={{ marginTop: '1rem' }}>
            {INTEGRATION_PROVIDERS.map((provider) => {
              const status = connections[provider]
              const label = providerLabels[provider]
              const reason = status?.reason
              return (
                <div key={provider} style={{ marginBottom: '1rem' }}>
                  <strong>{label}</strong>
                  <span style={{ marginLeft: '0.5rem', color: 'var(--color-muted)' }}>
                    {status ? statusLabel(status) : '—'}
                  </span>
                  {provider === 'gtm' && publicContainerId ? (
                    <p style={{ fontSize: '0.9rem', margin: '0.35rem 0' }}>
                      Container ID: <code>{publicContainerId}</code>
                    </p>
                  ) : null}
                  {status && !status.ready ? (
                    <div className="actions" style={{ marginTop: '0.35rem' }}>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() =>
                          void (reason === 'selection_required'
                            ? undefined
                            : connectProvider(provider, returnPath))
                        }
                      >
                        Connect
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void onReconnect(provider)}
                      >
                        Reconnect
                      </button>
                    </div>
                  ) : null}
                  {provider === 'google_ads' && reason === 'selection_required' ? (
                    <GoogleAdsCustomerSelector
                      businessId={businessId}
                      onSaved={() => void refetchConnections()}
                    />
                  ) : null}
                  {provider === 'gtm' && reason === 'selection_required' ? (
                    <GtmResourceSelector
                      businessId={businessId}
                      onSaved={() => void refetchConnections()}
                    />
                  ) : null}
                  {provider === 'gbp' && !status?.ready ? (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ marginTop: '0.35rem' }}
                      onClick={() => void onSkipGbp()}
                    >
                      Skip GBP for now
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>

          <div className="field" style={{ maxWidth: '20rem' }}>
            <label htmlFor="setup-currency">Google Ads account currency</label>
            <select
              id="setup-currency"
              value={currencyCode}
              onChange={(e) => setCurrencyCode(e.target.value as AccountCurrency)}
            >
              <option value="USD">USD</option>
              <option value="INR">INR</option>
            </select>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginTop: '0.5rem' }}
              disabled={currencyBusy}
              onClick={() => void onSaveCurrency()}
            >
              {currencyBusy ? 'Saving…' : 'Save currency'}
            </button>
          </div>

          <div style={{ marginTop: '1.5rem' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={snippetBusy}
              onClick={() => void onCheckSnippet()}
            >
              {snippetBusy ? 'Checking…' : 'Test: is GTM on my site?'}
            </button>
            {snippetStatus ? (
              <p style={{ marginTop: '0.5rem' }}>
                <strong>{snippetCheckDisplayLabel(snippetStatus, snippetErrorMessage)}</strong>
              </p>
            ) : null}
          </div>

          {step1Pending.length > 0 ? (
            <p style={{ marginTop: '1rem', color: 'var(--color-muted)' }}>
              Still needed: {step1Pending.join(' · ')}
            </p>
          ) : null}
        </section>
      ) : null}

      {step === 2 ? (
        <section>
          <h2>Step 2 — Confirm your facts</h2>
          <p style={{ color: 'var(--color-muted)' }}>
            Review what we know about your business. Fix anything that is wrong, then confirm.
          </p>
          {context ? (
            <dl style={{ fontSize: '0.95rem' }}>
              <dt>Business name</dt>
              <dd>{context.businessName ?? '—'}</dd>
              <dt>Website</dt>
              <dd>{context.websiteUrl ?? '—'}</dd>
              <dt>Phone</dt>
              <dd>{readPhone(context.contactMethods) || '—'}</dd>
            </dl>
          ) : null}
          <form className="form" onSubmit={(e) => void onConfirmFacts(e)}>
            <div className="field">
              <label htmlFor="fact-services">What you sell (one per line)</label>
              <textarea
                id="fact-services"
                value={factForm.services}
                onChange={(e) => setFactForm((f) => ({ ...f, services: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="fact-who">Who buys from you today</label>
              <textarea
                id="fact-who"
                value={factForm.whoBuysToday}
                onChange={(e) => setFactForm((f) => ({ ...f, whoBuysToday: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="fact-areas">Where you serve</label>
              <textarea
                id="fact-areas"
                value={factForm.serviceAreas}
                onChange={(e) => setFactForm((f) => ({ ...f, serviceAreas: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="fact-order">Typical order value</label>
              <input
                id="fact-order"
                value={factForm.orderValueHint}
                onChange={(e) => setFactForm((f) => ({ ...f, orderValueHint: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="fact-contact">How buyers contact you</label>
              <input
                id="fact-contact"
                value={factForm.howBuyersContact}
                onChange={(e) =>
                  setFactForm((f) => ({ ...f, howBuyersContact: e.target.value }))
                }
              />
            </div>
            <button type="submit" className="btn btn-primary" disabled={factBusy}>
              {factBusy ? 'Saving…' : step2Done ? 'Update & confirm facts' : 'Confirm facts'}
            </button>
            {step2Done ? (
              <p style={{ color: 'var(--color-muted)', marginTop: '0.75rem' }}>
                Facts confirmed {context?.factCheckCompletedAt
                  ? new Date(context.factCheckCompletedAt).toLocaleString()
                  : ''}
                .
              </p>
            ) : null}
          </form>
        </section>
      ) : null}

      {step === 3 ? (
        <section>
          <h2>Step 3 — Campaign objectives</h2>
          <p style={{ color: 'var(--color-muted)' }}>
            Set strategy fields your campaigns will use. Campaign drafts below are read-only until an
            expert approves them.
          </p>
          <form className="form" onSubmit={(e) => void onSaveStrategy(e)}>
            <div className="field">
              <label htmlFor="str-uvp">Unique value proposition</label>
              <textarea
                id="str-uvp"
                value={strategyForm.uvp}
                onChange={(e) => setStrategyForm((f) => ({ ...f, uvp: e.target.value }))}
              />
            </div>
            <div className="field">
              <label htmlFor="str-scope">Business scope</label>
              <select
                id="str-scope"
                value={strategyForm.businessScope}
                onChange={(e) =>
                  setStrategyForm((f) => ({
                    ...f,
                    businessScope: e.target.value as BusinessContextDto['businessScope'],
                  }))
                }
              >
                <option value="">Select…</option>
                <option value="local_service">Local service</option>
                <option value="regional">Regional</option>
                <option value="national_online">National / online</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="str-vc">Value × complexity</label>
              <select
                id="str-vc"
                value={strategyForm.valueComplexity}
                onChange={(e) =>
                  setStrategyForm((f) => ({
                    ...f,
                    valueComplexity: e.target.value as BusinessContextDto['valueComplexity'],
                  }))
                }
              >
                <option value="">Select…</option>
                <option value="low_value_low_complexity">Low value, low complexity</option>
                <option value="low_value_high_complexity">Low value, high complexity</option>
                <option value="high_value_low_complexity">High value, low complexity</option>
                <option value="high_value_high_complexity">High value, high complexity</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="str-budget">Budget tier</label>
              <select
                id="str-budget"
                value={strategyForm.budgetTier}
                onChange={(e) =>
                  setStrategyForm((f) => ({
                    ...f,
                    budgetTier: e.target.value as BusinessContextDto['budgetTier'],
                  }))
                }
              >
                <option value="">Select…</option>
                <option value="starter">Starter</option>
                <option value="growth">Growth</option>
                <option value="scale">Scale</option>
              </select>
            </div>
            <button type="submit" className="btn btn-primary" disabled={strategyBusy}>
              {strategyBusy ? 'Saving…' : 'Save objectives'}
            </button>
          </form>

          <div style={{ marginTop: '2rem' }}>
            <h3>Campaign drafts</h3>
            <p style={{ color: 'var(--color-muted)' }}>
              An expert will review and approve your campaigns before you can run them.
            </p>
            {(['recommended', 'alternative'] as const).map((slot) => {
              const draft = dashboard?.slots[slot]
              if (!draft) {
                return (
                  <p key={slot}>
                    <strong>{slot}</strong> — not generated yet.
                  </p>
                )
              }
              return (
                <div
                  key={slot}
                  style={{
                    border: '1px solid var(--color-border)',
                    padding: '1rem',
                    marginBottom: '1rem',
                    borderRadius: '6px',
                  }}
                >
                  <p style={{ margin: 0 }}>
                    <strong>{slot}</strong> ·{' '}
                    <span>{draftStatusLabel(draft.reviewStatus)}</span>
                  </p>
                  <p style={{ fontSize: '0.9rem', margin: '0.5rem 0 0' }}>
                    {draft.action ?? '—'} · {draft.offer ?? '—'}
                  </p>
                  <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', margin: 0 }}>
                    {draft.places?.join(', ') ?? '—'} · {draft.page ?? '—'}
                  </p>
                </div>
              )
            })}
          </div>
        </section>
      ) : null}

      {step === 4 ? (
        <section>
          <h2>Step 4 — Tracking test &amp; run</h2>
          {gbpSkipped ? (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              You skipped Google Business Profile. Local visibility may be limited until GBP is
              connected.
            </div>
          ) : null}
          <p style={{ color: 'var(--color-muted)' }}>
            Prove conversions reach Google Ads with a real form submit or phone call after you start
            the test.
          </p>
          <div className="actions" style={{ marginBottom: '1rem' }}>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={trackingBusy}
              onClick={() => void onStartTrackingTest()}
            >
              Start test
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={trackingBusy || !trackingStartedAt}
              onClick={() => void onPollTracking()}
            >
              Check result
            </button>
          </div>
          {trackingStartedAt ? (
            <p style={{ fontSize: '0.9rem', color: 'var(--color-muted)' }}>
              Test started {new Date(trackingStartedAt).toLocaleString()}. Submit a real lead form
              or place a real call to your business number, then check result.
            </p>
          ) : null}
          <ul>
            {(primaryGoal === 'forms' || primaryGoal === 'both') && (
              <li>Form goal: {trackingGoalLabel(trackingGoals.forms)}</li>
            )}
            {(primaryGoal === 'calls' || primaryGoal === 'both') && (
              <li>Call goal: {trackingGoalLabel(trackingGoals.calls)}</li>
            )}
          </ul>

          <h3 style={{ marginTop: '2rem' }}>Run campaigns</h3>
          {(['recommended', 'alternative'] as const).map((slot) => (
            <div key={slot} className="actions" style={{ marginBottom: '0.5rem' }}>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canRun || runBusy !== null}
                onClick={() => void onRunSlot(slot)}
              >
                {runBusy === slot
                  ? 'Starting…'
                  : !draftsApproved
                    ? 'Campaigns pending review'
                    : `Run ${slot}`}
              </button>
            </div>
          ))}
          {runDisabledReason && !canRun ? (
            <p style={{ fontSize: '0.9rem', color: 'var(--color-muted)' }}>{runDisabledReason}</p>
          ) : null}
        </section>
      ) : null}
    </PageLayout>
  )
}
