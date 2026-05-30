import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { startSetupRun } from '../../api/setupRuns'
import type { ProvisioningProvider } from '../../api/integrations'
import { ErrorAlert } from '../feedback/ErrorAlert'
import { InlineLoading } from '../feedback/InlineLoading'
import { useProvisioningOverview } from '../../hooks/useProvisioningOverview'
import { useOnboardingState } from '../../hooks/useOnboardingState'
import { provisioningCopy } from '../../lib/provisioningUi'

interface ProvisioningConsentCardProps {
  businessId: string
  setupRunId: string
  provider: ProvisioningProvider
}

export function ProvisioningConsentCard({
  businessId,
  setupRunId,
  provider,
}: ProvisioningConsentCardProps): ReactElement {
  const navigate = useNavigate()
  const { setSetupRunId } = useOnboardingState()
  const {
    overview,
    loading,
    error,
    refetch,
    createRequest,
    approveRequest,
    cancelRequest,
    mutationByProvider,
  } = useProvisioningOverview(businessId)

  const [notice, setNotice] = useState<string | null>(null)
  const [continueBusy, setContinueBusy] = useState(false)
  const [continueError, setContinueError] = useState<string | null>(null)
  const autoCreateAttemptedRef = useRef(false)

  const copy = provisioningCopy(provider)
  const providerState = overview?.providers[provider] ?? null
  const activeRequest = providerState?.activeRequest ?? providerState?.latestRequest ?? null
  const mutation = mutationByProvider[provider]
  const requestStatus = activeRequest?.status ?? null

  useEffect(() => {
    autoCreateAttemptedRef.current = false
  }, [provider, setupRunId])

  useEffect(() => {
    if (loading || !providerState?.provisioningRequired) return
    if (activeRequest) return
    if (autoCreateAttemptedRef.current) return
    autoCreateAttemptedRef.current = true
    void createRequest(provider, setupRunId)
  }, [
    loading,
    providerState?.provisioningRequired,
    activeRequest,
    createRequest,
    provider,
    setupRunId,
  ])

  async function onApprove(): Promise<void> {
    if (!activeRequest) return
    setNotice(null)
    const approved = await approveRequest(activeRequest.id)
    if (approved?.status === 'approved') {
      setNotice('Approved. Start setup again to provision resources and continue.')
    }
  }

  async function onCancel(): Promise<void> {
    if (!activeRequest || activeRequest.status !== 'pending_approval') return
    setNotice(null)
    await cancelRequest(activeRequest.id)
  }

  async function onContinueSetup(): Promise<void> {
    setContinueError(null)
    setContinueBusy(true)
    try {
      const res = await startSetupRun(businessId)
      setSetupRunId(res.setupRunId)
      navigate(`/setup/progress/${res.setupRunId}`, { replace: true })
    } catch (err) {
      setContinueError(err instanceof ApiError ? err.message : 'Could not start setup.')
    } finally {
      setContinueBusy(false)
    }
  }

  return (
    <section
      className="alert alert-info"
      style={{ marginTop: '1rem' }}
      aria-labelledby={`provisioning-consent-${provider}`}
    >
      <h2 id={`provisioning-consent-${provider}`} style={{ fontSize: '1rem', marginBottom: '0.5rem' }}>
        {copy.title}
      </h2>
      <p style={{ marginTop: 0, marginBottom: '0.5rem' }}>{copy.missing}</p>
      <p style={{ marginTop: 0, marginBottom: '0.5rem' }}>{copy.willCreate}</p>
      <p style={{ marginTop: 0, marginBottom: '0.75rem', fontSize: '0.875rem' }}>{copy.whyApproval}</p>

      <p style={{ fontSize: '0.875rem', marginBottom: '0.35rem' }}>
        <strong>Resources requested</strong>
      </p>
      <ul className="stepsList" style={{ marginBottom: '0.75rem' }}>
        {copy.resources.map((resource) => (
          <li key={resource}>{resource}</li>
        ))}
      </ul>
      <p style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginBottom: '0.75rem' }}>
        {copy.gbpNote}
      </p>

      <ErrorAlert message={error ?? mutation?.error ?? continueError} />

      {loading && !overview ? <InlineLoading label="Loading provisioning status…" /> : null}

      {activeRequest ? (
        <p style={{ fontSize: '0.875rem', marginBottom: '0.75rem' }}>
          Request status:{' '}
          <span className="statusPill status-review">{requestStatus ?? 'unknown'}</span>
        </p>
      ) : null}

      {notice ? (
        <div className="alert alert-info" style={{ marginBottom: '0.75rem' }}>
          {notice}
        </div>
      ) : null}

      <div className="actions" style={{ marginTop: '0.5rem', flexWrap: 'wrap' }}>
        {!activeRequest && !loading ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={mutation?.busy}
            onClick={() => void createRequest(provider, setupRunId)}
          >
            {mutation?.busy ? <InlineLoading label="Creating request…" /> : 'Create provisioning request'}
          </button>
        ) : null}

        {activeRequest?.status === 'pending_approval' ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={mutation?.busy}
            onClick={() => void onApprove()}
          >
            {mutation?.busy ? <InlineLoading label="Approving…" /> : 'Approve provisioning'}
          </button>
        ) : null}

        {activeRequest?.status === 'approved' || notice ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={continueBusy}
            onClick={() => void onContinueSetup()}
          >
            {continueBusy ? <InlineLoading label="Starting setup…" /> : 'Continue setup'}
          </button>
        ) : null}

        <button type="button" className="btn btn-secondary" onClick={() => void refetch()}>
          Refresh status
        </button>

        {activeRequest?.status === 'pending_approval' ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={mutation?.busy}
            onClick={() => void onCancel()}
          >
            Cancel request
          </button>
        ) : null}
      </div>
    </section>
  )
}
