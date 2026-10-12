import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { getBusinessContext, updateBusinessContext } from '../api/businessContexts'
import {
  checkBusinessSetupSnippet,
  confirmBusinessSetupFacts,
  pollBusinessSetupTrackingTest,
  startBusinessSetupTrackingTest,
  type SnippetCheckResult,
} from '../api/businessSetup'
import { createGtmBusinessSetupContainer, fetchIntegrationStatus } from '../api/integrations'
import {
  getLeadCampaignDashboard,
  type LeadCampaignDashboardResponse,
} from '../api/leadCampaigns'
import { GoogleAdsCreateAccountForm } from '../components/integrations/GoogleAdsCreateAccountForm'
import { GoogleAdsCustomerSelector } from '../components/integrations/GoogleAdsCustomerSelector'
import { GtmResourceSelector } from '../components/integrations/GtmResourceSelector'
import { gtmBodyInstallSnippet, gtmHeadInstallScript } from '../lib/gtmInstallSnippets'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import { useAuth } from '../hooks/useAuth'
import { useOnboardingState } from '../hooks/useOnboardingState'
import { useIntegrationConnections } from '../hooks/useIntegrationConnections'
import {
  isStep2Complete,
  readPrimaryGoal,
  step1PendingItems,
  trackingGoalLabel,
} from '../lib/businessSetupUi'
import type { BusinessContextDto, BusinessContextUpdateBody } from '../types/api'
import type { IntegrationProvider } from '../api/integrations'

const STEP_NAV_LABELS = ['Accounts', 'Facts', 'Goal', 'Tracking'] as const
const STEP_HEADINGS = [
  'Step 1 - Accounts',
  'Step 2 Business Info',
  'Step 3 Business Goal',
  'Step 4 - Tracking',
] as const

const ACCOUNTS_STEP_PROVIDERS = ['google_ads', 'gtm', 'gbp'] as const satisfies readonly IntegrationProvider[]

const GTM_ACCOUNT_HELP_URL = 'https://tagmanager.google.com/'
const GBP_ACCOUNT_HELP_URL = 'https://business.google.com/create'

function CopyableSnippetBlock({ label, text }: { label: string; text: string }): ReactElement {
  const [copied, setCopied] = useState(false)
  async function onCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  return (
    <div style={{ marginTop: '0.75rem' }}>
      <div className="actions" style={{ alignItems: 'center', marginBottom: '0.35rem' }}>
        <strong style={{ fontSize: '0.9rem' }}>{label}</strong>
        <button type="button" className="btn btn-secondary" style={{ marginLeft: '0.5rem' }} onClick={() => void onCopy()}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre
        style={{
          fontSize: '0.8rem',
          padding: '0.75rem',
          overflowX: 'auto',
          border: '1px solid var(--color-border)',
          borderRadius: '6px',
          whiteSpace: 'pre-wrap',
        }}
      >
        {text}
      </pre>
    </div>
  )
}

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
  const [adsCreateFormOpen, setAdsCreateFormOpen] = useState(false)
  const [gtmContainerBusy, setGtmContainerBusy] = useState(false)
  const [gtmContainerError, setGtmContainerError] = useState<string | null>(null)
  const gtmContainerAutoAttemptedRef = useRef(false)
  const [snippetBusy, setSnippetBusy] = useState(false)
  const [snippetStatus, setSnippetStatus] = useState<SnippetCheckResult['status'] | null>(null)
  const [snippetErrorMessage, setSnippetErrorMessage] = useState<string | null>(null)
  const [gbpSkipped, setGbpSkipped] = useState(false)
  const [factBusy, setFactBusy] = useState(false)
  const [strategyBusy, setStrategyBusy] = useState(false)
  const [trackingStartedAt, setTrackingStartedAt] = useState<string | null>(null)
  const [trackingGoals, setTrackingGoals] = useState<Record<string, string>>({})
  const [trackingBusy, setTrackingBusy] = useState(false)

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
      setGbpSkipped(Boolean(data.gbpSkippedAt))
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
        const statusRes = await fetchIntegrationStatus(businessId)
        if (cancelled) return
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
  const step1Pending = step1PendingItems(connections)
  const step2Done = isStep2Complete(context)

  const tryCreateGtmContainer = useCallback(
    async (manualRetry = false): Promise<void> => {
      if (!businessId) return
      const gtm = connections.gtm
      if (!gtm || gtm.ready) return
      const ids = gtm.providerIdentifiers ?? {}
      const accountId = typeof ids.accountId === 'string' ? ids.accountId : null
      const containerId = typeof ids.containerId === 'string' ? ids.containerId : null
      if (!accountId || containerId) return
      if (!manualRetry && gtmContainerAutoAttemptedRef.current) return
      if (!manualRetry) gtmContainerAutoAttemptedRef.current = true
      setGtmContainerBusy(true)
      setGtmContainerError(null)
      try {
        await createGtmBusinessSetupContainer(businessId)
        await refetchConnections()
      } catch (err) {
        setGtmContainerError(
          err instanceof ApiError ? err.message : 'Could not create Tag Manager container.',
        )
      } finally {
        setGtmContainerBusy(false)
      }
    },
    [businessId, connections.gtm, refetchConnections],
  )

  useEffect(() => {
    if (step !== 1) return
    void tryCreateGtmContainer(false)
  }, [step, tryCreateGtmContainer])

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
      <p style={{ margin: '0 0 1rem', fontSize: '0.95rem' }}>
        <Link to="/">Back to home</Link>
      </p>
      <ErrorAlert message={error ?? connectionsError} />

      <nav className="actions" style={{ marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        {STEP_NAV_LABELS.map((label, index) => {
          const n = index + 1
          return (
            <button
              key={label}
              type="button"
              className={step === n ? 'btn btn-primary' : 'btn btn-secondary'}
              onClick={() => setStep(n)}
            >
              {label}
            </button>
          )
        })}
      </nav>

      {step === 1 ? (
        <section>
          <h2>{STEP_HEADINGS[0]}</h2>
          <p style={{ color: 'var(--color-muted)' }}>
            Connect Google Ads and Tag Manager. Google Business Profile is optional.
          </p>
          <ErrorAlert message={gtmContainerError} />
          {gtmContainerBusy ? <InlineLoading label="Setting up Tag Manager container…" /> : null}
          {gtmContainerError ? (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ marginBottom: '0.75rem' }}
              disabled={gtmContainerBusy}
              onClick={() => void tryCreateGtmContainer(true)}
            >
              Retry container setup
            </button>
          ) : null}
          {connectionsLoading ? <InlineLoading label="Loading connections…" /> : null}
          <div style={{ marginTop: '1rem' }}>
            {ACCOUNTS_STEP_PROVIDERS.map((provider, index) => {
              const status = connections[provider]
              const label = providerLabels[provider]
              const reason = status?.reason
              return (
                <div key={provider}>
                  {index > 0 ? (
                    <hr
                      style={{
                        margin: '1.5rem 0',
                        border: 'none',
                        borderTop: '1px solid var(--color-border)',
                      }}
                    />
                  ) : null}
                  <div style={{ marginBottom: '0.5rem' }}>
                    <strong>{label}</strong>
                    <span style={{ marginLeft: '0.5rem', color: 'var(--color-muted)' }}>
                      {status ? statusLabel(status) : '—'}
                    </span>
                    {provider === 'gtm' && status?.ready && publicContainerId ? (
                      <div style={{ marginTop: '0.5rem' }}>
                        <CopyableSnippetBlock label="Container ID" text={publicContainerId} />
                        <CopyableSnippetBlock
                          label="Head install script"
                          text={gtmHeadInstallScript(publicContainerId)}
                        />
                        <CopyableSnippetBlock
                          label="Body install snippet"
                          text={gtmBodyInstallSnippet(publicContainerId)}
                        />
                      </div>
                    ) : null}
                    {status && !status.ready && reason !== 'selection_required' ? (
                      <div style={{ marginTop: '0.35rem' }}>
                        <div className="actions">
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => void connectProvider(provider, returnPath)}
                          >
                            Connect
                          </button>
                        </div>
                        {provider === 'gtm' ? (
                          <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
                            <a href={GTM_ACCOUNT_HELP_URL} target="_blank" rel="noreferrer">
                              Don&apos;t have an account?
                            </a>
                          </p>
                        ) : null}
                        {provider === 'gbp' ? (
                          <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
                            <a href={GBP_ACCOUNT_HELP_URL} target="_blank" rel="noreferrer">
                              Don&apos;t have an account?
                            </a>
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                    {provider === 'google_ads' && status && !status.ready ? (
                      <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
                        <button
                          type="button"
                          className="btn btn-link"
                          style={{ padding: 0, fontSize: 'inherit' }}
                          onClick={() => setAdsCreateFormOpen((open) => !open)}
                        >
                          Don&apos;t have an account?
                        </button>
                      </p>
                    ) : null}
                    {provider === 'google_ads' && adsCreateFormOpen && !status?.ready ? (
                      <GoogleAdsCreateAccountForm
                        businessId={businessId}
                        onCreated={() => {
                          setAdsCreateFormOpen(false)
                          void refetchConnections()
                        }}
                      />
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
                  </div>
                </div>
              )
            })}
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
          <h2>{STEP_HEADINGS[1]}</h2>
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
          <h2>{STEP_HEADINGS[2]}</h2>
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
                value={strategyForm.businessScope ?? ''}
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
                value={strategyForm.valueComplexity ?? ''}
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
                value={strategyForm.budgetTier ?? ''}
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
          <h2>{STEP_HEADINGS[3]}</h2>
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
          <div className="actions" style={{ marginBottom: '1rem', flexWrap: 'wrap' }}>
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
            <button
              type="button"
              className="btn btn-secondary"
              disabled={snippetBusy}
              onClick={() => void onCheckSnippet()}
            >
              {snippetBusy ? 'Checking…' : 'Test: is GTM on my site?'}
            </button>
          </div>
          {snippetStatus ? (
            <p style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
              <strong>{snippetCheckDisplayLabel(snippetStatus, snippetErrorMessage)}</strong>
            </p>
          ) : null}
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

          <p style={{ marginTop: '2rem', fontSize: '0.95rem', color: 'var(--color-muted)' }}>
            After tracking passes and an operator approves your campaigns, they will start them for
            you.
          </p>
        </section>
      ) : null}
    </PageLayout>
  )
}
