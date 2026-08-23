import { useEffect } from 'react'
import type { ReactElement } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import { useSetupRunReport } from '../hooks/useSetupRunReport'
import { useOnboardingState } from '../hooks/useOnboardingState'
import { conversionActionHeadline } from '../lib/conversionActionsUi'
import { RecoveryPlaybook } from '../components/setup/RecoveryPlaybook'
import { EnableCampaignCard } from '../components/setup/EnableCampaignCard'
import { CampaignPerformanceCard } from '../components/setup/CampaignPerformanceCard'
import { GbpWritePanel } from '../components/integrations/GbpWritePanel'
import { MetaConnectPanel } from '../components/integrations/MetaConnectPanel'

function adsCampaignFailureHeadline(failure: {
  bucketLabel: string | null
}): string {
  if (failure.bucketLabel) {
    return `Google Ads campaign creation failed in ${failure.bucketLabel}`
  }
  return 'Google Ads campaign creation failed'
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

function outcomeTone(kind: string): string {
  if (kind === 'succeeded') return 'status-succeeded'
  if (kind === 'failed') return 'status-failed'
  if (kind === 'in_progress') return 'status-running'
  return 'status-review'
}

export function SetupReportPage(): ReactElement {
  const { setupRunId: paramId } = useParams<{ setupRunId: string }>()
  const { snapshot, setSetupRunId } = useOnboardingState()
  const effectiveId = paramId ?? snapshot.setupRunId

  useEffect(() => {
    if (paramId && paramId !== snapshot.setupRunId) setSetupRunId(paramId)
  }, [paramId, snapshot.setupRunId, setSetupRunId])

  const { report, loading, error, lastUpdatedAt, refetch } = useSetupRunReport(effectiveId ?? null)

  if (!effectiveId) {
    return (
      <PageLayout title="Setup report" lead="No setup run selected.">
        <ErrorAlert message="Missing setupRunId." />
        <Link className="btn btn-primary" to="/setup">
          Go to setup
        </Link>
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="Setup report"
      lead="Summary of your automated Google setup run."
    >
      <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '1rem' }}>
        Run <code style={{ wordBreak: 'break-all', fontSize: '0.8rem' }}>{effectiveId}</code>
      </p>
      <ErrorAlert message={error} />
      {loading && !report ? <InlineLoading /> : null}

      {report ? (
        <>
          {report.outcome.kind === 'succeeded' && report.setupRun.businessId ? (
            <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
              Setup finished successfully. You can{' '}
              <Link to={`/business-context/${report.setupRun.businessId}/edit`}>
                edit your business profile
              </Link>{' '}
              in Zuggernaut — changes do not update Google Ads or GTM automatically.
            </div>
          ) : null}
          <section style={{ marginTop: '0.75rem' }}>
            <span className={`statusPill ${statusTone(report.setupRun.status)}`}>
              {report.setupRun.status}
            </span>
            <span
              className={`statusPill ${outcomeTone(report.outcome.kind)}`}
              style={{ marginLeft: '0.5rem' }}
            >
              {report.outcome.kind.replace(/_/g, ' ')}
            </span>
          </section>

          <section style={{ marginTop: '1.5rem' }}>
            <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Outcome</h2>
            <p style={{ fontSize: '0.875rem' }}>{report.outcome.headline}</p>
            {report.setupRun.lastErrorSummary ? (
              <div className="alert alert-error" style={{ marginTop: '0.75rem' }}>
                {report.setupRun.lastErrorSummary}
              </div>
            ) : null}
            {report.outcome.recovery ? <RecoveryPlaybook recovery={report.outcome.recovery} /> : null}
          </section>

          {report.supportState?.failedStep ? (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Support details</h2>
              <ul className="stepsList">
                <li>
                  <strong>Failed step</strong> · {report.supportState.failedStep.replace(/_/g, ' ')}
                </li>
                {report.supportState.errorCode ? (
                  <li>
                    <strong>Error code</strong> · {report.supportState.errorCode}
                  </li>
                ) : null}
              </ul>
            </section>
          ) : null}

          {report.provisioning.gtm.status !== 'not_required' ||
          report.provisioning.googleAds.status !== 'not_required' ? (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Provisioning status</h2>
              <ul className="stepsList">
                {report.provisioning.gtm.status !== 'not_required' ? (
                  <li>
                    <strong>Google Tag Manager</strong> ·{' '}
                    {report.provisioning.gtm.status.replace(/_/g, ' ')}
                  </li>
                ) : null}
                {report.provisioning.googleAds.status !== 'not_required' ? (
                  <li>
                    <strong>Google Ads</strong> ·{' '}
                    {report.provisioning.googleAds.status.replace(/_/g, ' ')}
                  </li>
                ) : null}
              </ul>
            </section>
          ) : null}

          {report.business ? (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Business</h2>
              <ul className="stepsList">
                <li>
                  <strong>Name</strong> · {report.business.businessName ?? '—'}
                </li>
                <li>
                  <strong>Website</strong> · {report.business.websiteUrl ?? '—'}
                </li>
              </ul>
            </section>
          ) : null}

          {report.gbpAudit.status !== 'not_run' ? (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>GBP audit</h2>
              {report.gbpAudit.status === 'skipped' ? (
                <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>
                  GBP audit was skipped — connect Google Business Profile to include it in future runs.
                </p>
              ) : null}
              {report.gbpAudit.status === 'guidance' && report.gbpAudit.guidance ? (
                <div style={{ marginBottom: '0.75rem' }}>
                  <p style={{ fontSize: '0.875rem', marginTop: 0, marginBottom: '0.35rem' }}>
                    <strong>{report.gbpAudit.guidance.title}</strong>
                  </p>
                  <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginTop: 0 }}>
                    {report.gbpAudit.guidance.message}
                  </p>
                  <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginBottom: 0 }}>
                    GBP is optional for setup — this run continued without blocking automation.
                  </p>
                </div>
              ) : null}
              {report.gbpAudit.summary ? (
                <ul className="stepsList">
                  <li>
                    <strong>Present</strong> · {report.gbpAudit.summary.presentCount}
                  </li>
                  <li>
                    <strong>Missing</strong> · {report.gbpAudit.summary.missingCount}
                  </li>
                  <li>
                    <strong>Needs attention</strong> · {report.gbpAudit.summary.needsAttentionCount}
                  </li>
                </ul>
              ) : null}
              {report.gbpAudit.findings?.missing && report.gbpAudit.findings.missing.length > 0 ? (
                <p style={{ fontSize: '0.875rem', marginTop: '0.5rem' }}>
                  Missing fields: {report.gbpAudit.findings.missing.join(', ')}
                </p>
              ) : null}
            </section>
          ) : null}

          {report.conversionActions.status !== 'not_run' ? (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Conversion actions</h2>
              <p style={{ fontSize: '0.875rem', marginTop: 0 }}>
                {conversionActionHeadline(report.conversionActions)}
              </p>
              {report.conversionActions.status === 'ready' ? (
                <ul className="stepsList" style={{ marginTop: '0.75rem' }}>
                  <li>
                    <strong>Slots resolved</strong> · {report.conversionActions.slotsResolved}
                  </li>
                  <li>
                    <strong>Reused</strong> · {report.conversionActions.reused}
                  </li>
                  <li>
                    <strong>Created</strong> · {report.conversionActions.created}
                  </li>
                </ul>
              ) : report.conversionActions.message ? (
                <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginTop: '0.5rem' }}>
                  {report.conversionActions.message}
                </p>
              ) : null}
            </section>
          ) : null}

          {report.adsCatalog.status === 'ready' && report.adsCatalog.summary ? (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Ads conversion catalog</h2>
              <ul className="stepsList">
                <li>
                  <strong>Primary goal</strong> · {report.adsCatalog.summary.primaryGoal}
                </li>
                <li>
                  <strong>In catalog</strong> · {report.adsCatalog.summary.totalInCatalog}
                </li>
                <li>
                  <strong>Selected</strong> · {report.adsCatalog.summary.selectedCount} (
                  {report.adsCatalog.summary.selectedCategories.join(', ')})
                </li>
              </ul>
            </section>
          ) : null}

          {report.gtmSetup.status === 'setup_complete' && report.gtmSetup.summary ? (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>GTM setup</h2>
              <ul className="stepsList">
                <li>
                  <strong>Tags</strong> · {report.gtmSetup.summary.tagsCreated} created
                </li>
                <li>
                  <strong>Triggers</strong> · {report.gtmSetup.summary.triggersCreated} created
                </li>
                <li>
                  <strong>Variables</strong> · {report.gtmSetup.summary.variablesCreated} created
                </li>
                <li>
                  <strong>Published version</strong> ·{' '}
                  <code style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>
                    {report.gtmSetup.summary.publishedVersion}
                  </code>
                </li>
              </ul>
            </section>
          ) : null}

          {report.structuralVerification.status !== 'not_run' ? (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Structural verification</h2>
              <p style={{ fontSize: '0.875rem' }}>
                Status: <strong>{report.structuralVerification.status.replace(/_/g, ' ')}</strong>
              </p>
              {report.structuralVerification.summary ? (
                <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginTop: '0.35rem' }}>
                  {report.structuralVerification.summary}
                </p>
              ) : null}
              {report.structuralVerification.evidence?.missing &&
              report.structuralVerification.evidence.missing.length > 0 ? (
                <ul className="stepsList" style={{ marginTop: '0.5rem' }}>
                  {report.structuralVerification.evidence.missing.map((item) => (
                    <li key={item}>
                      <strong>{item.replace(/_/g, ' ')}</strong>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}

          {report.outcome.kind === 'succeeded' && report.gtmSetup.status === 'not_run' ? (
            <div className="alert alert-info" style={{ marginTop: '1.5rem' }}>
              <strong>GTM skipped</strong> — conversion tracking is not configured on your website yet.
            </div>
          ) : null}

          {report.gtmSetup.status === 'setup_complete' ||
          report.structuralVerification.evidence?.publicContainerId ? (
            <div className="alert alert-info" style={{ marginTop: '1.5rem' }}>
              <strong>Install your GTM snippet</strong>
              <p style={{ fontSize: '0.875rem', margin: '0.5rem 0' }}>
                Your GTM container is connected. Add the container snippet to your website so tags can
                fire.
                {report.structuralVerification.evidence?.publicContainerId ? (
                  <>
                    {' '}
                    Container ID:{' '}
                    <code style={{ fontSize: '0.8rem' }}>
                      {report.structuralVerification.evidence.publicContainerId}
                    </code>
                    .
                  </>
                ) : null}
              </p>
              <a
                className="btn btn-primary"
                href="https://tagmanager.google.com/"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Google Tag Manager
              </a>
            </div>
          ) : null}

          {report.recommendations.length > 0 ? (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Recommendations</h2>
              <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginTop: 0 }}>
                Complete these optional steps when you are ready to improve conversion tracking.
              </p>
              {report.recommendations.map((item) => (
                <div
                  key={item.id}
                  className="alert alert-info"
                  style={{ marginTop: '0.75rem', marginBottom: 0 }}
                >
                  <strong>{item.title}</strong>
                  <p style={{ fontSize: '0.875rem', marginTop: '0.5rem', marginBottom: '0.5rem' }}>
                    {item.message}
                  </p>
                  <ol style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.875rem' }}>
                    {item.steps.map((step) => (
                      <li key={step} style={{ marginBottom: '0.35rem' }}>
                        {step}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </section>
          ) : null}

          {report.adsCampaign.status === 'failed' && report.adsCampaign.failure ? (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Google Ads campaign</h2>
              <div className="alert alert-error">
                <p style={{ marginTop: 0, marginBottom: '0.75rem' }}>
                  {adsCampaignFailureHeadline(report.adsCampaign.failure)}
                </p>
                <ul className="stepsList" style={{ marginBottom: 0 }}>
                  {report.adsCampaign.failure.field ? (
                    <li>
                      <strong>Parameter</strong> ·{' '}
                      <code style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>
                        {report.adsCampaign.failure.field}
                      </code>
                    </li>
                  ) : null}
                  {report.adsCampaign.failure.code ? (
                    <li>
                      <strong>Error code</strong> · {report.adsCampaign.failure.code}
                    </li>
                  ) : null}
                  {report.adsCampaign.failure.recommendedAction ? (
                    <li>
                      <strong>Recommended action</strong> · {report.adsCampaign.failure.recommendedAction}
                    </li>
                  ) : null}
                </ul>
              </div>
            </section>
          ) : null}

          {report.adsCampaign.status === 'campaigns_recorded' && report.adsCampaign.summary ? (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Google Ads campaign</h2>
              {report.adsCampaign.plan?.campaignName ? (
                <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '0.5rem' }}>
                  {report.adsCampaign.plan.campaignName}
                </p>
              ) : null}
              <ul className="stepsList">
                <li>
                  <strong>Campaign</strong> ·{' '}
                  {report.adsCampaign.summary.campaignCreated ? 'created paused' : 'skipped'}
                </li>
                <li>
                  <strong>Ad group</strong> ·{' '}
                  {report.adsCampaign.summary.adGroupCreated ? 'created' : 'skipped'}
                </li>
                <li>
                  <strong>Ad</strong> · {report.adsCampaign.summary.adCreated ? 'created' : 'skipped'}
                </li>
                <li>
                  <strong>Conversion links</strong> · {report.adsCampaign.summary.conversionLinkCount}
                </li>
                <li>
                  <strong>Campaign ID</strong> ·{' '}
                  <code style={{ fontSize: '0.75rem', wordBreak: 'break-all' }}>
                    {report.adsCampaign.summary.campaignExternalId}
                  </code>
                </li>
              </ul>
            </section>
          ) : null}

          {report.setupRun.status === 'SUCCEEDED' &&
          report.adsCampaign.summary?.campaignCreated &&
          report.setupRun.businessId ? (
            <EnableCampaignCard businessId={report.setupRun.businessId} />
          ) : null}

          {report.setupRun.status === 'SUCCEEDED' &&
          report.adsCampaign.summary?.campaignCreated &&
          report.setupRun.businessId ? (
            <CampaignPerformanceCard businessId={report.setupRun.businessId} />
          ) : null}

          {report.setupRun.businessId ? (
            <>
              <GbpWritePanel businessId={report.setupRun.businessId} />
              <MetaConnectPanel businessId={report.setupRun.businessId} />
            </>
          ) : null}

          {Object.values(report.artifactCounts).some((count) => count > 0) ? (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Artifacts created</h2>
              <ul className="stepsList">
                <li>
                  <strong>GTM tags</strong> · {report.artifactCounts.gtmTags}
                </li>
                <li>
                  <strong>GTM triggers</strong> · {report.artifactCounts.gtmTriggers}
                </li>
                <li>
                  <strong>GTM variables</strong> · {report.artifactCounts.gtmVariables}
                </li>
                <li>
                  <strong>Ads conversions</strong> · {report.artifactCounts.adsConversions}
                </li>
                <li>
                  <strong>Ads campaigns</strong> · {report.artifactCounts.adsCampaigns}
                </li>
                <li>
                  <strong>Conversion links</strong> · {report.artifactCounts.adsConversionLinks}
                </li>
              </ul>
            </section>
          ) : null}

          {report.compensation?.actions && report.compensation.actions.length > 0 ? (
            <section style={{ marginTop: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Partial setup actions</h2>
              <ul className="stepsList">
                {report.compensation.actions.map((action) => (
                  <li key={`${action.type}-${action.campaignResourceName ?? action.message ?? action.outcome}`}>
                    <strong>{action.type.replace(/_/g, ' ')}</strong>
                    {action.outcome ? <> · {action.outcome}</> : null}
                    {action.message ? (
                      <div style={{ fontSize: '0.875rem', marginTop: '0.35rem' }}>{action.message}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {report.stuckState.stuck ? (
            <div className="alert alert-info" style={{ marginTop: '1rem' }}>
              <strong>Setup appears stuck.</strong>{' '}
              {report.stuckState.guidance ?? 'Verify the Temporal worker and refresh this page.'}
            </div>
          ) : null}

          <section style={{ marginTop: '1.5rem' }}>
            <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Step history</h2>
            <ul className="stepsList">
              {report.steps.length === 0 ? (
                <li>No step rows yet.</li>
              ) : (
                report.steps.map((step) => (
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
          </section>

          {typeof lastUpdatedAt === 'number' ? (
            <p style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginTop: '1rem' }}>
              Last loaded: {new Date(lastUpdatedAt).toLocaleTimeString()}
            </p>
          ) : null}
        </>
      ) : null}

      <div className="actions" style={{ marginTop: '2rem' }}>
        <button type="button" className="btn btn-secondary" onClick={() => void refetch()}>
          Refresh
        </button>
        <Link className="btn btn-secondary" to={`/setup/progress/${effectiveId}`}>
          Back to progress
        </Link>
        <Link className="btn btn-secondary" to="/">
          Home
        </Link>
      </div>
    </PageLayout>
  )
}
