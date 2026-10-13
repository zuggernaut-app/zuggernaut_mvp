import { useEffect, useState, type ReactElement } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { pollBusinessSetupTrackingTest } from '../api/businessSetup'
import { listBusinessContexts } from '../api/businessContexts'
import { fetchIntegrationStatus } from '../api/integrations'
import { getLeadCampaignDashboard } from '../api/leadCampaigns'
import { LeadCampaignDashboard } from '../components/dashboard/LeadCampaignDashboard'
import { PageLayout } from '../components/layout/PageLayout'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { useAuth } from '../hooks/useAuth'
import { useOnboardingState } from '../hooks/useOnboardingState'
import { isQuestionsComplete, isSignupComplete, resolveOnboardingPath } from '../lib/onboardingRouting'
import { buildSetupProgressItems } from '../lib/setupProgressUi'
import type { BusinessContextDto } from '../types/api'
import type { IntegrationConnectionStatusDto } from '../api/integrations'

function resolveActiveBusinessContext(
  contexts: BusinessContextDto[],
  storedBusinessId: string | null,
  primaryBusinessId: string | null | undefined,
): BusinessContextDto | null {
  if (contexts.length === 0) return null

  const completedContexts = contexts
    .filter((ctx) => isQuestionsComplete(ctx))
    .sort(
      (a, b) =>
        Date.parse(b.questionsCompletedAt ?? b.confirmedAt ?? '') -
        Date.parse(a.questionsCompletedAt ?? a.confirmedAt ?? ''),
    )

  if (completedContexts.length > 0) {
    if (storedBusinessId) {
      const storedCompleted = completedContexts.find((ctx) => ctx.businessId === storedBusinessId)
      if (storedCompleted) return storedCompleted
    }

    if (primaryBusinessId) {
      const primaryCompleted = completedContexts.find(
        (ctx) => ctx.businessId === primaryBusinessId,
      )
      if (primaryCompleted) return primaryCompleted
    }

    return completedContexts[0]
  }

  if (storedBusinessId) {
    const storedMatch = contexts.find((ctx) => ctx.businessId === storedBusinessId)
    if (storedMatch) return storedMatch
  }

  if (primaryBusinessId) {
    const primaryMatch = contexts.find((ctx) => ctx.businessId === primaryBusinessId)
    if (primaryMatch) return primaryMatch
  }

  if (contexts.length === 1) return contexts[0]

  return null
}

export function HomePage(): ReactElement {
  const { user, loading } = useAuth()
  const { snapshot, setBusinessId } = useOnboardingState()
  const [contextLoading, setContextLoading] = useState(false)
  const [activeContext, setActiveContext] = useState<BusinessContextDto | null | undefined>(
    undefined,
  )
  const [hasLeadCampaigns, setHasLeadCampaigns] = useState(false)
  const [dashboardChecked, setDashboardChecked] = useState(false)
  const [connections, setConnections] = useState<
    Record<string, IntegrationConnectionStatusDto | null> | null
  >(null)
  const [trackingTestResult, setTrackingTestResult] = useState<Record<string, string> | null>(
    null,
  )

  useEffect(() => {
    if (!user) {
      setActiveContext(undefined)
      setDashboardChecked(false)
      setHasLeadCampaigns(false)
      setConnections(null)
      setTrackingTestResult(null)
      return
    }

    let cancelled = false
    void (async () => {
      setContextLoading(true)
      setDashboardChecked(false)
      try {
        const res = await listBusinessContexts()
        const resolved = resolveActiveBusinessContext(
          res.businessContexts,
          snapshot.businessId,
          user.primaryBusinessId,
        )
        if (!cancelled) {
          if (resolved) setBusinessId(resolved.businessId)
          setActiveContext(resolved)
          if (isQuestionsComplete(resolved)) {
            try {
              const [dashboard, integrationStatus, trackingPoll] = await Promise.all([
                getLeadCampaignDashboard(resolved!.businessId),
                fetchIntegrationStatus(resolved!.businessId),
                pollBusinessSetupTrackingTest(resolved!.businessId).catch(() => null),
              ])
              const anySlot =
                dashboard.slots.recommended != null || dashboard.slots.alternative != null
              setHasLeadCampaigns(anySlot)
              setConnections(integrationStatus.connections)
              setTrackingTestResult(trackingPoll?.goals ?? null)
            } catch {
              setHasLeadCampaigns(false)
              setConnections(null)
              setTrackingTestResult(null)
            }
          } else {
            setHasLeadCampaigns(false)
            setConnections(null)
            setTrackingTestResult(null)
          }
          setDashboardChecked(true)
        }
      } catch {
        if (!cancelled) {
          setActiveContext(null)
          setDashboardChecked(true)
        }
      } finally {
        if (!cancelled) setContextLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [user, snapshot.businessId, user?.primaryBusinessId, setBusinessId])

  if (
    loading ||
    (user && (contextLoading || activeContext === undefined || !dashboardChecked))
  ) {
    return (
      <PageLayout title="Welcome">
        <InlineLoading />
      </PageLayout>
    )
  }

  if (!user) {
    return (
      <PageLayout
        title="Welcome"
        lead="Tell us about your business. We'll set up Google Ads for you."
      >
        <div className="actions" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <Link className="btn btn-primary" to="/register">
            Start — register
          </Link>
          <Link className="btn btn-secondary" to="/login">
            Log in
          </Link>
        </div>
      </PageLayout>
    )
  }

  const onboardingPath = resolveOnboardingPath(activeContext)
  if (onboardingPath) {
    return <Navigate to={onboardingPath} replace />
  }

  if (activeContext && isQuestionsComplete(activeContext) && hasLeadCampaigns) {
    return (
      <PageLayout
        title={activeContext.businessName ?? 'Your campaigns'}
        lead="Monitor your lead campaigns."
      >
        <LeadCampaignDashboard businessId={activeContext.businessId} />
      </PageLayout>
    )
  }

  if (
    activeContext &&
    (isQuestionsComplete(activeContext) || isSignupComplete(activeContext))
  ) {
    const questionsDone = isQuestionsComplete(activeContext)
    const progress = questionsDone
      ? buildSetupProgressItems(activeContext, connections, trackingTestResult)
      : []
    const signupThankYou = isSignupComplete(activeContext) && !questionsDone
    return (
      <PageLayout
        title="Thank you"
        lead={
          signupThankYou
            ? 'We will call you to finish setup.'
            : "We'll call you to take this forward."
        }
      >
        {signupThankYou ? (
          <>
            <p style={{ margin: '0 0 1rem', color: 'var(--color-muted)' }}>
              Plan for about 30 minutes on the call. Have your website open and the person who can
              change your website code on the call or reachable.
            </p>
            <p style={{ margin: '0 0 1rem', color: 'var(--color-muted)' }}>
              Have documents ready for reference, such as a company brochure or annual report.
            </p>
            <p style={{ margin: '0 0 1rem', fontSize: '0.95rem' }}>
              <Link to="/signup/business-details">Edit your business details</Link>
            </p>
          </>
        ) : (
          <p style={{ margin: '0 0 1rem', color: 'var(--color-muted)' }}>
            An expert will call you to help finish setup.
          </p>
        )}
        {progress.length > 0 ? (
          <ul style={{ margin: '0 0 1rem', paddingLeft: '1.25rem', color: 'var(--color-muted)' }}>
            {progress.map((item) => (
              <li key={item.id}>
                {item.label}: {item.done ? 'Done' : 'Still open'}
              </li>
            ))}
          </ul>
        ) : null}
        {questionsDone ? (
          <p style={{ margin: '0 0 1rem', fontSize: '0.95rem' }}>
            <Link to="/onboarding/business" state={{ editMode: true }}>
              Change your answers
            </Link>
          </p>
        ) : null}
        <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--color-muted)' }}>
          Signed in as <strong>{user.email}</strong>.
        </p>
      </PageLayout>
    )
  }

  return (
    <PageLayout title="Welcome" lead="Let's get your account set up.">
      <div className="actions" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', color: 'var(--color-muted)' }}>
          Signed in as <strong>{user.email}</strong>.
        </p>
        <Link className="btn btn-primary" to="/onboarding/accounts">
          Get started
        </Link>
      </div>
    </PageLayout>
  )
}
