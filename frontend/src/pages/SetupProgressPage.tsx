import { useEffect } from 'react'
import type { ReactElement } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import {
  INTEGRATION_PROVIDERS,
  useIntegrationConnections,
} from '../hooks/useIntegrationConnections'
import { useSetupRunStatus } from '../hooks/useSetupRunStatus'
import { useOnboardingState } from '../hooks/useOnboardingState'
import { ProvisioningConsentCard } from '../components/provisioning/ProvisioningConsentCard'
import {
  isProvisioningRequiredStatus,
  providerFromProvisioningStatus,
} from '../lib/provisioningUi'
import {
  conversionActionHeadline,
  parseConversionActionMeta,
} from '../lib/conversionActionsUi'

interface GbpAuditSummary {
  presentCount: number
  missingCount: number
  needsAttentionCount: number
}

interface GbpGuidance {
  code: string
  title: string
  message: string
  blocking: boolean
}

function parseGbpGuidance(raw: unknown): GbpGuidance | null {
  if (!raw || typeof raw !== 'object') return null
  const g = raw as Record<string, unknown>
  if (
    typeof g.code !== 'string' ||
    typeof g.title !== 'string' ||
    typeof g.message !== 'string' ||
    typeof g.blocking !== 'boolean'
  ) {
    return null
  }
  return {
    code: g.code,
    title: g.title,
    message: g.message,
    blocking: g.blocking,
  }
}

function parseGbpAuditMeta(meta: unknown): {
  status: 'complete' | 'skipped' | 'guidance' | null
  summary: GbpAuditSummary | null
  guidance: GbpGuidance | null
} {
  if (!meta || typeof meta !== 'object') {
    return { status: null, summary: null, guidance: null }
  }
  const m = meta as Record<string, unknown>
  const status =
    m.gbpAudit === 'complete' || m.gbpAudit === 'skipped' || m.gbpAudit === 'guidance'
      ? m.gbpAudit
      : null
  const guidance = parseGbpGuidance(m.gbpGuidance)
  const raw = m.gbpAuditSummary
  if (!raw || typeof raw !== 'object') return { status, summary: null, guidance }
  const s = raw as Record<string, unknown>
  if (
    typeof s.presentCount !== 'number' ||
    typeof s.missingCount !== 'number' ||
    typeof s.needsAttentionCount !== 'number'
  ) {
    return { status, summary: null, guidance }
  }
  return {
    status,
    summary: {
      presentCount: s.presentCount,
      missingCount: s.missingCount,
      needsAttentionCount: s.needsAttentionCount,
    },
    guidance,
  }
}

interface CatalogSummary {
  primaryGoal: string
  totalInCatalog: number
  selectedCount: number
  selectedCategories: string[]
}

function parseCatalogMeta(meta: unknown): {
  status: 'ready' | null
  summary: CatalogSummary | null
} {
  if (!meta || typeof meta !== 'object') return { status: null, summary: null }
  const m = meta as Record<string, unknown>
  const status = m.catalog === 'ready' ? 'ready' : null
  const raw = m.catalogSummary
  if (!raw || typeof raw !== 'object') return { status, summary: null }
  const s = raw as Record<string, unknown>
  if (
    typeof s.primaryGoal !== 'string' ||
    typeof s.totalInCatalog !== 'number' ||
    typeof s.selectedCount !== 'number' ||
    !Array.isArray(s.selectedCategories)
  ) {
    return { status, summary: null }
  }
  return {
    status,
    summary: {
      primaryGoal: s.primaryGoal,
      totalInCatalog: s.totalInCatalog,
      selectedCount: s.selectedCount,
      selectedCategories: s.selectedCategories.map(String),
    },
  }
}

interface GtmSetupSummary {
  templateVersion: number
  tagsCreated: number
  triggersCreated: number
  variablesCreated: number
  reusedArtifacts: number
  publishedVersion: string
}

function parseGtmMeta(meta: unknown): {
  status: 'setup_complete' | null
  summary: GtmSetupSummary | null
} {
  if (!meta || typeof meta !== 'object') return { status: null, summary: null }
  const m = meta as Record<string, unknown>
  const status = m.gtm === 'setup_complete' ? 'setup_complete' : null
  const raw = m.gtmSummary
  if (!raw || typeof raw !== 'object') return { status, summary: null }
  const s = raw as Record<string, unknown>
  if (
    typeof s.templateVersion !== 'number' ||
    typeof s.tagsCreated !== 'number' ||
    typeof s.triggersCreated !== 'number' ||
    typeof s.variablesCreated !== 'number' ||
    typeof s.publishedVersion !== 'string'
  ) {
    return { status, summary: null }
  }
  return {
    status,
    summary: {
      templateVersion: s.templateVersion,
      tagsCreated: s.tagsCreated,
      triggersCreated: s.triggersCreated,
      variablesCreated: s.variablesCreated,
      reusedArtifacts: typeof s.reusedArtifacts === 'number' ? s.reusedArtifacts : 0,
      publishedVersion: s.publishedVersion,
    },
  }
}

interface StructuralVerificationEvidence {
  missing?: string[]
  snippetPresent?: boolean | null
  publicContainerId?: string | null
}

interface AdsCampaignSummary {
  campaignCreated: boolean
  adGroupCreated: boolean
  adCreated: boolean
  reusedArtifacts: number
  campaignExternalId: string
  conversionLinkCount: number
}

function parseAdsCampaignMeta(meta: unknown): {
  status: 'campaigns_recorded' | null
  summary: AdsCampaignSummary | null
} {
  if (!meta || typeof meta !== 'object') return { status: null, summary: null }
  const m = meta as Record<string, unknown>
  const status = m.ads === 'campaigns_recorded' ? 'campaigns_recorded' : null
  const raw = m.adsCampaignSummary
  if (!raw || typeof raw !== 'object') return { status, summary: null }
  const s = raw as Record<string, unknown>
  if (
    typeof s.campaignCreated !== 'boolean' ||
    typeof s.adGroupCreated !== 'boolean' ||
    typeof s.adCreated !== 'boolean' ||
    typeof s.campaignExternalId !== 'string' ||
    typeof s.conversionLinkCount !== 'number'
  ) {
    return { status, summary: null }
  }
  return {
    status,
    summary: {
      campaignCreated: s.campaignCreated,
      adGroupCreated: s.adGroupCreated,
      adCreated: s.adCreated,
      reusedArtifacts: typeof s.reusedArtifacts === 'number' ? s.reusedArtifacts : 0,
      campaignExternalId: s.campaignExternalId,
      conversionLinkCount: s.conversionLinkCount,
    },
  }
}

type ProvisioningProviderStatus = 'not_required' | 'approval_required' | 'provisioned' | 'failed'

function parseProvisioningMeta(
  meta: unknown,
  runStatus: string,
): {
  gtm: { status: ProvisioningProviderStatus; requestId: string | null }
  googleAds: { status: ProvisioningProviderStatus; requestId: string | null }
} {
  const m = meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {}
  const gtmMeta = m.gtmProvisioning
  const adsMeta = m.googleAdsProvisioning

  let gtmStatus: ProvisioningProviderStatus = 'not_required'
  if (runStatus === 'GTM_PROVISIONING_REQUIRED') gtmStatus = 'approval_required'
  else if (gtmMeta === 'provisioned') gtmStatus = 'provisioned'
  else if (gtmMeta === 'failed') gtmStatus = 'failed'

  let adsStatus: ProvisioningProviderStatus = 'not_required'
  if (runStatus === 'ADS_PROVISIONING_REQUIRED') adsStatus = 'approval_required'
  else if (adsMeta === 'provisioned') adsStatus = 'provisioned'
  else if (adsMeta === 'failed') adsStatus = 'failed'

  return {
    gtm: {
      status: gtmStatus,
      requestId: typeof m.gtmProvisioningRequestId === 'string' ? m.gtmProvisioningRequestId : null,
    },
    googleAds: {
      status: adsStatus,
      requestId:
        typeof m.googleAdsProvisioningRequestId === 'string' ? m.googleAdsProvisioningRequestId : null,
    },
  }
}

function deriveStructuralVerificationStatus(
  runStatus: string,
  verifyStep: { status: string; details?: unknown } | undefined,
): 'pass' | 'snippet_pending' | 'needs_tracking_fix' | 'manual_review' | null {
  if (verifyStep?.status === 'success' || runStatus === 'STRUCTURAL_VERIFIED') return 'pass'
  if (runStatus === 'GTM_SNIPPET_PENDING') return 'snippet_pending'
  if (runStatus === 'SETUP_NEEDS_TRACKING_FIX') return 'needs_tracking_fix'
  if (runStatus === 'SETUP_NEEDS_MANUAL_REVIEW') return 'manual_review'
  if (verifyStep?.status === 'failed') {
    const details =
      verifyStep.details && typeof verifyStep.details === 'object'
        ? (verifyStep.details as { snippetPending?: boolean })
        : null
    if (details?.snippetPending === true) return 'snippet_pending'
    return 'needs_tracking_fix'
  }
  return null
}

function parseStructuralVerificationMeta(meta: unknown): StructuralVerificationEvidence | null {
  if (!meta || typeof meta !== 'object') return null
  const m = meta as Record<string, unknown>
  const raw = m.structuralVerification
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  return {
    missing: Array.isArray(e.missing) ? e.missing.map(String) : undefined,
    snippetPresent: typeof e.snippetPresent === 'boolean' ? e.snippetPresent : null,
    publicContainerId:
      typeof e.publicContainerId === 'string' ? e.publicContainerId : null,
  }
}

function statusTone(status: string): string {
  if (status === 'RUNNING') return 'status-running'
  if (status === 'FAILED') return 'status-failed'
  if (status === 'SUCCEEDED') return 'status-succeeded'
  if (status === 'SETUP_NEEDS_TRACKING_FIX') return 'status-needs-fix'
  if (status === 'GTM_SNIPPET_PENDING') return 'status-review'
  if (status === 'SETUP_NEEDS_MANUAL_REVIEW') return 'status-review'
  if (status === 'GTM_PROVISIONING_REQUIRED') return 'status-review'
  if (status === 'ADS_PROVISIONING_REQUIRED') return 'status-review'
  return ''
}

function isTerminalSetupStatus(status: string): boolean {
  return (
    status === 'SUCCEEDED' ||
    status === 'FAILED' ||
    status === 'SETUP_NEEDS_MANUAL_REVIEW' ||
    status === 'SETUP_NEEDS_TRACKING_FIX' ||
    status === 'GTM_SNIPPET_PENDING'
  )
}

export function SetupProgressPage(): ReactElement {
  const { setupRunId: paramId } = useParams<{ setupRunId: string }>()
  const { snapshot, setSetupRunId } = useOnboardingState()
  const effectiveId = paramId ?? snapshot.setupRunId

  useEffect(() => {
    if (paramId && paramId !== snapshot.setupRunId) setSetupRunId(paramId)
  }, [paramId, snapshot.setupRunId, setSetupRunId])

  const { data, loading, error, lastUpdatedAt, appearsStuck, pollingPaused, refetch } =
    useSetupRunStatus(effectiveId ?? null)

  const run = data?.setupRun
  const businessId = run?.businessId ?? snapshot.businessId ?? null
  const {
    connections,
    loading: connectionsLoading,
    connectProvider,
    providerLabels,
    statusLabel,
    refetch: refetchConnections,
  } = useIntegrationConnections(businessId)

  const showConnections =
    run?.status === 'SETUP_NEEDS_MANUAL_REVIEW' || run?.status === 'SETUP_NEEDS_TRACKING_FIX'

  const gbpAudit = parseGbpAuditMeta(run?.meta ?? null)
  const gbpStep = (data?.steps ?? []).find((step) => step.stepName === 'gbp_audit')
  const gbpStepSummary =
    gbpStep?.details &&
    typeof gbpStep.details === 'object' &&
    gbpStep.details !== null &&
    typeof (gbpStep.details as { summary?: unknown }).summary === 'object'
      ? ((gbpStep.details as { summary: GbpAuditSummary }).summary ?? null)
      : null
  const gbpSummary = gbpAudit.summary ?? gbpStepSummary

  const conversionActions = parseConversionActionMeta(run?.meta ?? null)
  const manageStep = (data?.steps ?? []).find(
    (step) => step.stepName === 'manage_ads_conversion_actions',
  )
  const conversionReviewMessage =
    manageStep?.status === 'failed' && manageStep.lastErrorSummary
      ? manageStep.lastErrorSummary
      : null

  const catalog = parseCatalogMeta(run?.meta ?? null)
  const catalogStep = (data?.steps ?? []).find((step) => step.stepName === 'ads_conversion_catalog')
  const catalogStepSummary =
    catalogStep?.details &&
    typeof catalogStep.details === 'object' &&
    catalogStep.details !== null &&
    typeof (catalogStep.details as { summary?: unknown }).summary === 'object'
      ? ((catalogStep.details as { summary: CatalogSummary }).summary ?? null)
      : null
  const catalogSummary = catalog.summary ?? catalogStepSummary

  const gtm = parseGtmMeta(run?.meta ?? null)
  const gtmStep = (data?.steps ?? []).find((step) => step.stepName === 'gtm_conversion_setup')
  const gtmStepSummary =
    gtmStep?.details &&
    typeof gtmStep.details === 'object' &&
    gtmStep.details !== null &&
    typeof (gtmStep.details as { summary?: unknown }).summary === 'object'
      ? ((gtmStep.details as { summary: GtmSetupSummary }).summary ?? null)
      : null
  const gtmSummary = gtm.summary ?? gtmStepSummary
  const structuralEvidence = parseStructuralVerificationMeta(run?.meta ?? null)
  const structuralSummary =
    run?.meta &&
    typeof run.meta === 'object' &&
    typeof (run.meta as Record<string, unknown>).structuralVerificationSummary === 'string'
      ? String((run.meta as Record<string, unknown>).structuralVerificationSummary)
      : null
  const verifyStep = (data?.steps ?? []).find((step) => step.stepName === 'structural_verification')
  const structuralStatus = run
    ? deriveStructuralVerificationStatus(run.status, verifyStep)
    : null
  const provisioning = parseProvisioningMeta(run?.meta ?? null, run?.status ?? '')
  const publicContainerId = structuralEvidence?.publicContainerId ?? null

  const adsCampaign = parseAdsCampaignMeta(run?.meta ?? null)
  const adsCampaignStep = (data?.steps ?? []).find((step) => step.stepName === 'ads_campaign_creation')
  const adsCampaignStepSummary =
    adsCampaignStep?.details &&
    typeof adsCampaignStep.details === 'object' &&
    adsCampaignStep.details !== null &&
    typeof (adsCampaignStep.details as { summary?: unknown }).summary === 'object'
      ? ((adsCampaignStep.details as { summary: AdsCampaignSummary }).summary ?? null)
      : null
  const adsCampaignSummary = adsCampaign.summary ?? adsCampaignStepSummary

  const provisioningProvider =
    run && isProvisioningRequiredStatus(run.status)
      ? providerFromProvisioningStatus(run.status)
      : null

  if (!effectiveId) {
    return (
      <PageLayout title="Setup progress" lead="No setup run selected.">
        <ErrorAlert message="Missing setupRunId." />
        <Link className="btn btn-primary" to="/setup">
          Go to setup
        </Link>
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="Setup progress"
      lead="Polling the API while the Temporal worker advances steps."
    >
      <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '1rem' }}>
        Run <code style={{ wordBreak: 'break-all', fontSize: '0.8rem' }}>{effectiveId}</code>
      </p>
      <ErrorAlert message={error} />
      {loading && !data ? <InlineLoading /> : null}

      {run ? (
        <>
          <section style={{ marginTop: '0.75rem' }}>
            <span className={`statusPill ${statusTone(run.status)}`}>{run.status}</span>
            {pollingPaused ? (
              <span
                style={{
                  marginLeft: '0.5rem',
                  fontSize: '0.8rem',
                  color: 'var(--color-muted)',
                }}
              >
                Polling paused (workflow not RUNNING).
              </span>
            ) : null}
          </section>
          {run.lastErrorSummary ? (
            <div className="alert alert-error" style={{ marginTop: '1rem' }}>
              {run.lastErrorSummary}
            </div>
          ) : null}
          {provisioningProvider && businessId ? (
            <ProvisioningConsentCard
              businessId={businessId}
              setupRunId={effectiveId}
              provider={provisioningProvider}
            />
          ) : null}
          {run.status === 'GTM_SNIPPET_PENDING' ? (
            <div className="alert alert-info" style={{ marginTop: '1rem' }}>
              <strong>Install the Google Tag Manager snippet</strong>
              <p style={{ marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                GTM is configured in your container, but the snippet was not detected on your website.
                Add the GTM container snippet to the <code>&lt;head&gt;</code> of every page on your site
                (especially pages where conversions happen).
              </p>
              {publicContainerId ? (
                <p style={{ fontSize: '0.875rem' }}>
                  Container ID:{' '}
                  <code style={{ wordBreak: 'break-all' }}>{publicContainerId}</code>
                </p>
              ) : null}
              <p style={{ marginTop: '0.5rem', fontSize: '0.875rem' }}>
                After installing, click Refresh below. If the snippet is live, start a new setup run to
                continue to Google Ads campaign creation.
              </p>
            </div>
          ) : null}
          {run.status === 'SETUP_NEEDS_TRACKING_FIX' ? (
            <div className="alert alert-info" style={{ marginTop: '1rem' }}>
              Tracking setup needs attention: GTM tags, triggers, or conversion linkage may be incomplete.
              Confirm the site URL matches where the container is loaded, fix any structural issues listed
              below, then start a new setup run if needed.
            </div>
          ) : null}
          {run.status === 'SETUP_NEEDS_MANUAL_REVIEW' ? (
            <div className="alert alert-info" style={{ marginTop: '1rem' }}>
              {conversionReviewMessage ? (
                <>
                  <strong>Conversion actions need review</strong>
                  <p style={{ marginTop: '0.5rem', marginBottom: 0 }}>{conversionReviewMessage}</p>
                </>
              ) : (
                <>
                  Connect Google Tag Manager and Google Ads (and optionally GBP for audit), then retry setup.
                  This status means automation stopped until integrations are healthy.
                </>
              )}
            </div>
          ) : null}
          {gbpAudit.status === 'skipped' ? (
            <div className="alert alert-info" style={{ marginTop: '1rem' }}>
              GBP audit skipped — connect Google Business Profile on the setup page to include a
              read-only profile check in future runs.
            </div>
          ) : null}
          {gbpAudit.status === 'guidance' && gbpAudit.guidance ? (
            <section className="alert alert-info" style={{ marginTop: '1rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>{gbpAudit.guidance.title}</h2>
              <p style={{ marginTop: 0, marginBottom: '0.5rem' }}>{gbpAudit.guidance.message}</p>
              <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-muted)' }}>
                Google Business Profile is optional for setup. Connect or claim a profile to enable
                the read-only audit on a future run.
              </p>
            </section>
          ) : null}
          {gbpAudit.status === 'complete' && gbpSummary ? (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>GBP audit summary</h2>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '0.5rem' }}>
                Read-only comparison of your Google Business Profile against confirmed business
                context.
              </p>
              <ul className="stepsList">
                <li>
                  <strong>Present</strong> · {gbpSummary.presentCount} field
                  {gbpSummary.presentCount === 1 ? '' : 's'}
                </li>
                <li>
                  <strong>Missing</strong> · {gbpSummary.missingCount} field
                  {gbpSummary.missingCount === 1 ? '' : 's'}
                </li>
                <li>
                  <strong>Needs attention</strong> · {gbpSummary.needsAttentionCount} item
                  {gbpSummary.needsAttentionCount === 1 ? '' : 's'}
                </li>
              </ul>
            </section>
          ) : null}
          {conversionActions.summary ? (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Conversion actions</h2>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '0.5rem' }}>
                {conversionActionHeadline(conversionActions.summary)}
              </p>
              <ul className="stepsList">
                <li>
                  <strong>Slots resolved</strong> · {conversionActions.summary.slotsResolved}
                </li>
                <li>
                  <strong>Reused</strong> · {conversionActions.summary.reused}
                </li>
                <li>
                  <strong>Created</strong> · {conversionActions.summary.created}
                </li>
              </ul>
            </section>
          ) : null}
          {catalog.status === 'ready' && catalogSummary ? (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Ads conversion catalog</h2>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '0.5rem' }}>
                Read-only fetch of Google Ads conversion actions, with deterministic selection for your
                primary goal.
              </p>
              <ul className="stepsList">
                <li>
                  <strong>Primary goal</strong> · {catalogSummary.primaryGoal}
                </li>
                <li>
                  <strong>In catalog</strong> · {catalogSummary.totalInCatalog} conversion
                  {catalogSummary.totalInCatalog === 1 ? '' : 's'}
                </li>
                <li>
                  <strong>Selected</strong> · {catalogSummary.selectedCount} (
                  {catalogSummary.selectedCategories.join(', ')})
                </li>
              </ul>
            </section>
          ) : null}
          {gtm.status === 'setup_complete' && gtmSummary ? (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>GTM setup status</h2>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '0.5rem' }}>
                Conversion tags, triggers, and variables were created and a container version was
                published.
              </p>
              <ul className="stepsList">
                <li>
                  <strong>Tags</strong> · {gtmSummary.tagsCreated} created
                </li>
                <li>
                  <strong>Triggers</strong> · {gtmSummary.triggersCreated} created
                </li>
                <li>
                  <strong>Variables</strong> · {gtmSummary.variablesCreated} created
                </li>
                <li>
                  <strong>Published version</strong> ·{' '}
                  <code style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>
                    {gtmSummary.publishedVersion}
                  </code>
                </li>
              </ul>
            </section>
          ) : null}
          {adsCampaign.status === 'campaigns_recorded' && adsCampaignSummary ? (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Google Ads campaign</h2>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '0.5rem' }}>
                Search campaign, ad group, and responsive search ad were created (paused) and linked to
                your selected conversions.
              </p>
              <ul className="stepsList">
                <li>
                  <strong>Campaign</strong> ·{' '}
                  {adsCampaignSummary.campaignCreated ? 'created' : 'skipped'}
                  {adsCampaignSummary.reusedArtifacts > 0 ? ' (reused existing artifacts)' : ''}
                </li>
                <li>
                  <strong>Ad group</strong> · {adsCampaignSummary.adGroupCreated ? 'created' : 'skipped'}
                </li>
                <li>
                  <strong>Ad</strong> · {adsCampaignSummary.adCreated ? 'created' : 'skipped'}
                </li>
                <li>
                  <strong>Conversion links</strong> · {adsCampaignSummary.conversionLinkCount}
                </li>
                <li>
                  <strong>Campaign ID</strong> ·{' '}
                  <code style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>
                    {adsCampaignSummary.campaignExternalId}
                  </code>
                </li>
              </ul>
            </section>
          ) : null}
          {provisioning.gtm.status !== 'not_required' ||
          provisioning.googleAds.status !== 'not_required' ? (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Provisioning status</h2>
              <ul className="stepsList">
                {provisioning.gtm.status !== 'not_required' ? (
                  <li>
                    <strong>Google Tag Manager</strong> · {provisioning.gtm.status.replace(/_/g, ' ')}
                  </li>
                ) : null}
                {provisioning.googleAds.status !== 'not_required' ? (
                  <li>
                    <strong>Google Ads</strong> · {provisioning.googleAds.status.replace(/_/g, ' ')}
                  </li>
                ) : null}
              </ul>
            </section>
          ) : null}
          {structuralStatus ? (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Structural verification</h2>
              <p style={{ fontSize: '0.875rem', marginTop: 0 }}>
                Status: <strong>{structuralStatus.replace(/_/g, ' ')}</strong>
              </p>
              {structuralSummary ? (
                <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginTop: '0.35rem' }}>
                  {structuralSummary}
                </p>
              ) : null}
              {structuralEvidence?.snippetPresent === false && publicContainerId ? (
                <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginTop: '0.35rem' }}>
                  Install container <code>{publicContainerId}</code> on your website before campaigns can
                  launch.
                </p>
              ) : null}
              {structuralEvidence?.missing && structuralEvidence.missing.length > 0 ? (
                <ul className="stepsList" style={{ marginTop: '0.5rem' }}>
                  {structuralEvidence.missing.map((item) => (
                    <li key={item}>
                      <strong>{item.replace(/_/g, ' ')}</strong>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
          {showConnections ? (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Google integrations</h2>
              {connectionsLoading ? <InlineLoading label="Loading connections…" /> : null}
              <ul className="stepsList">
                {INTEGRATION_PROVIDERS.map((provider) => {
                  const status = connections[provider]
                  const ready = status?.ready === true
                  return (
                    <li key={provider}>
                      <div
                        style={{
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '0.5rem',
                          alignItems: 'center',
                        }}
                      >
                        <strong>{providerLabels[provider]}</strong>
                        <span className={`statusPill ${ready ? 'status-succeeded' : 'status-review'}`}>
                          {status ? statusLabel(status) : 'Loading…'}
                        </span>
                        {!ready ? (
                          <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => void connectProvider(provider)}
                          >
                            Connect Google
                          </button>
                        ) : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginTop: '0.75rem' }}
                onClick={() => void refetchConnections()}
              >
                Refresh connections
              </button>
            </section>
          ) : null}
          {appearsStuck || data?.stuckState?.stuck ? (
            <div className="alert alert-info" style={{ marginTop: '1rem' }}>
              <strong>Looks stuck?</strong>{' '}
              {data?.stuckState?.guidance ??
                'After several minutes in RUNNING, verify the Temporal worker logs, ensure MongoDB matches, and inspect the workflow in Temporal UI.'}
              {run.temporalWorkflowId ? (
                <span>
                  {' '}
                  Workflow id{' '}
                  <code style={{ wordBreak: 'break-all', fontSize: '0.8rem' }}>{run.temporalWorkflowId}</code>
                </span>
              ) : null}
              <div style={{ marginTop: '0.5rem' }}>
                Or try{' '}
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => void refetch()}
                >
                  refresh now
                </button>
              </div>
            </div>
          ) : null}
          {typeof lastUpdatedAt === 'number' ? (
            <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '1rem' }}>
              Last polled: {new Date(lastUpdatedAt).toLocaleTimeString()}
            </p>
          ) : null}
          <ul className="stepsList">
            {(data?.steps ?? []).length === 0 ? (
              <li>No step rows yet.</li>
            ) : (
              (data?.steps ?? []).map((step) => (
                <li key={step.id}>
                  <strong>{step.stepName}</strong> · {step.status}
                  {step.lastErrorSummary ? (
                    <div
                      style={{
                        color: 'var(--color-danger)',
                        marginTop: '0.35rem',
                        fontSize: '0.85rem',
                      }}
                    >
                      {step.lastErrorSummary}
                    </div>
                  ) : null}
                </li>
              ))
            )}
          </ul>
        </>
      ) : null}

      <div className="actions" style={{ marginTop: '2rem' }}>
        <button type="button" className="btn btn-secondary" onClick={() => void refetch()}>
          Refresh
        </button>
        {run && isTerminalSetupStatus(run.status) ? (
          <Link className="btn btn-primary" to={`/setup/report/${effectiveId}`}>
            View setup report
          </Link>
        ) : null}
        <Link className="btn btn-secondary" to="/">
          Home
        </Link>
      </div>
    </PageLayout>
  )
}
