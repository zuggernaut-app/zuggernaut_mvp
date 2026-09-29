import { useEffect, useState, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { listBusinessContexts } from '../api/businessContexts'
import { getLeadCampaignDashboard } from '../api/leadCampaigns'
import { LeadCampaignDashboard } from '../components/dashboard/LeadCampaignDashboard'
import { PageLayout } from '../components/layout/PageLayout'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { useAuth } from '../hooks/useAuth'
import { useOnboardingState } from '../hooks/useOnboardingState'
import type { BusinessContextDto } from '../types/api'

function resolveActiveBusinessContext(
  contexts: BusinessContextDto[],
  storedBusinessId: string | null,
  primaryBusinessId: string | null | undefined,
): BusinessContextDto | null {
  if (contexts.length === 0) return null

  const confirmedContexts = contexts
    .filter((ctx) => ctx.confirmedAt)
    .sort(
      (a, b) =>
        Date.parse(b.confirmedAt ?? '') - Date.parse(a.confirmedAt ?? ''),
    )

  if (confirmedContexts.length > 0) {
    if (storedBusinessId) {
      const storedConfirmed = confirmedContexts.find(
        (ctx) => ctx.businessId === storedBusinessId,
      )
      if (storedConfirmed) return storedConfirmed
    }

    if (primaryBusinessId) {
      const primaryConfirmed = confirmedContexts.find(
        (ctx) => ctx.businessId === primaryBusinessId,
      )
      if (primaryConfirmed) return primaryConfirmed
    }

    return confirmedContexts[0]
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

  useEffect(() => {
    if (!user) {
      setActiveContext(undefined)
      setDashboardChecked(false)
      setHasLeadCampaigns(false)
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
          if (resolved?.confirmedAt) {
            try {
              const dashboard = await getLeadCampaignDashboard(resolved.businessId)
              const anySlot =
                dashboard.slots.recommended != null || dashboard.slots.alternative != null
              setHasLeadCampaigns(anySlot)
            } catch {
              setHasLeadCampaigns(false)
            }
          } else {
            setHasLeadCampaigns(false)
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

  if (activeContext?.confirmedAt && hasLeadCampaigns) {
    return (
      <PageLayout
        title={activeContext.businessName ?? 'Your campaigns'}
        lead="Start, pause, and monitor your lead campaigns."
      >
        <LeadCampaignDashboard businessId={activeContext.businessId} />
      </PageLayout>
    )
  }

  if (activeContext?.confirmedAt) {
    return (
      <PageLayout title="Thank you" lead="We'll take it from here.">
        <p style={{ margin: '0 0 1rem', color: 'var(--color-muted)' }}>
          Your details are saved. Our team is reviewing your business and setting up your Google Ads
          campaign. There&apos;s nothing else you need to do right now.
        </p>
        <p style={{ margin: 0, fontSize: '0.95rem', color: 'var(--color-muted)' }}>
          Signed in as <strong>{user.email}</strong>.
        </p>
      </PageLayout>
    )
  }

  if (activeContext && !activeContext.confirmedAt) {
    return (
      <PageLayout
        title="Continue your details"
        lead="You're not done yet. Submit so our team can take over."
      >
        <div className="actions" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <p
            style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', color: 'var(--color-muted)' }}
          >
            Signed in as <strong>{user.email}</strong>.
          </p>
          <Link className="btn btn-primary" to="/onboarding/business">
            Continue
          </Link>
        </div>
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="Welcome"
      lead="Tell us about your business. We'll set up Google Ads for you."
    >
      <div className="actions" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.95rem', color: 'var(--color-muted)' }}>
          Signed in as <strong>{user.email}</strong>. This takes a few minutes — share the basics and
          connect Google Ads.
        </p>
        <Link className="btn btn-primary" to="/onboarding/business">
          Get started
        </Link>
      </div>
    </PageLayout>
  )
}
