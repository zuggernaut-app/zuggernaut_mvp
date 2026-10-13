import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listBusinessContexts } from '../api/businessContexts'
import { AuthProvider } from '../hooks/useAuth'
import { OnboardingProvider } from '../hooks/useOnboardingState'
import { TEST_IDS, seedSession } from '../test/pageTestUtils'
import { HomePage } from './HomePage'

const hoisted = vi.hoisted(() => ({
  mockAuthMe: vi.fn(),
  mockListBusinessContexts: vi.fn(),
  mockGetLeadCampaignDashboard: vi.fn(),
  mockGetAdsCampaignPerformance: vi.fn(),
  mockFetchIntegrationStatus: vi.fn(),
  mockPollBusinessSetupTrackingTest: vi.fn(),
}))

vi.mock('../api/businessContexts', () => ({
  listBusinessContexts: hoisted.mockListBusinessContexts,
}))

vi.mock('../api/leadCampaigns', () => ({
  getLeadCampaignDashboard: hoisted.mockGetLeadCampaignDashboard,
}))

vi.mock('../api/adsPerformance', () => ({
  getAdsCampaignPerformance: hoisted.mockGetAdsCampaignPerformance,
}))

vi.mock('../api/integrations', () => ({
  fetchIntegrationStatus: hoisted.mockFetchIntegrationStatus,
}))

vi.mock('../api/businessSetup', () => ({
  pollBusinessSetupTrackingTest: hoisted.mockPollBusinessSetupTrackingTest,
}))

vi.mock('../api/auth', () => ({
  authMe: hoisted.mockAuthMe,
  authRegister: vi.fn(),
  authLogin: vi.fn(),
  authLogout: vi.fn().mockResolvedValue({ ok: true }),
}))

function renderHome(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <OnboardingProvider>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route
              path="/signup/business-details"
              element={<div data-testid="signup-details-target">details</div>}
            />
            <Route
              path="/onboarding/accounts"
              element={<div data-testid="accounts-target">accounts</div>}
            />
            <Route
              path="/onboarding/business"
              element={<div data-testid="business-target">business</div>}
            />
          </Routes>
        </OnboardingProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    hoisted.mockAuthMe.mockResolvedValue({
      user: {
        id: TEST_IDS.user,
        email: 'owner@example.com',
        name: 'Owner',
        primaryBusinessId: null,
      },
    })
    hoisted.mockListBusinessContexts.mockResolvedValue({ businessContexts: [] })
    hoisted.mockGetLeadCampaignDashboard.mockResolvedValue({
      businessId: TEST_IDS.business,
      slots: { recommended: null, alternative: null },
    })
    hoisted.mockGetAdsCampaignPerformance.mockResolvedValue({
      performance: { businessId: TEST_IDS.business, slots: { recommended: null, alternative: null } },
    })
    hoisted.mockFetchIntegrationStatus.mockResolvedValue({ businessId: TEST_IDS.business, connections: {} })
    hoisted.mockPollBusinessSetupTrackingTest.mockResolvedValue({ goals: {} })
  })

  it('shows Get started when signed in with no businesses', async () => {
    renderHome()

    expect(await screen.findByRole('link', { name: /get started/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^continue$/i })).not.toBeInTheDocument()
  })

  it('shows thank you when signup is complete without sending user to account links', async () => {
    hoisted.mockListBusinessContexts.mockResolvedValue({
      businessContexts: [
        {
          businessId: TEST_IDS.business,
          userId: TEST_IDS.user,
          websiteUrl: null,
          businessName: 'Acme',
          industry: null,
          services: [],
          serviceAreas: [],
          contactMethods: null,
          audienceSignals: null,
          goals: null,
          differentiators: null,
          orderValueHint: null,
          thankYouUrls: [],
          uvp: null,
          competitorLandscape: null,
          businessScope: null,
          valueComplexity: null,
          budgetTier: null,
          susoVersion: 0,
          susoVersionUpdatedAt: null,
          confirmedAt: null,
          accountLinksCompletedAt: null,
          questionsCompletedAt: null,
          signupCompletedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    seedSession({ userId: TEST_IDS.user, businessId: TEST_IDS.business })

    renderHome()

    expect(await screen.findByRole('heading', { name: /^thank you$/i })).toBeInTheDocument()
    expect(screen.queryByTestId('accounts-target')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /change your answers/i })).not.toBeInTheDocument()
  })

  it('redirects to business details when signup is not complete', async () => {
    hoisted.mockListBusinessContexts.mockResolvedValue({
      businessContexts: [
        {
          businessId: TEST_IDS.business,
          userId: TEST_IDS.user,
          websiteUrl: null,
          businessName: 'Acme',
          industry: null,
          services: [],
          serviceAreas: [],
          contactMethods: null,
          audienceSignals: null,
          goals: null,
          differentiators: null,
          orderValueHint: null,
          thankYouUrls: [],
          uvp: null,
          competitorLandscape: null,
          businessScope: null,
          valueComplexity: null,
          budgetTier: null,
          susoVersion: 0,
          susoVersionUpdatedAt: null,
          confirmedAt: null,
          accountLinksCompletedAt: null,
          questionsCompletedAt: null,
        },
      ],
    })
    seedSession({ userId: TEST_IDS.user, businessId: TEST_IDS.business })

    renderHome()

    expect(await screen.findByTestId('signup-details-target')).toBeInTheDocument()
  })

  it('redirects to business details when account links are complete but signup is not', async () => {
    hoisted.mockListBusinessContexts.mockResolvedValue({
      businessContexts: [
        {
          businessId: TEST_IDS.business,
          userId: TEST_IDS.user,
          websiteUrl: null,
          businessName: 'Acme',
          industry: null,
          services: [],
          serviceAreas: [],
          contactMethods: null,
          audienceSignals: null,
          goals: null,
          differentiators: null,
          orderValueHint: null,
          thankYouUrls: [],
          uvp: null,
          competitorLandscape: null,
          businessScope: null,
          valueComplexity: null,
          budgetTier: null,
          susoVersion: 0,
          susoVersionUpdatedAt: null,
          confirmedAt: null,
          accountLinksCompletedAt: '2026-01-01T00:00:00.000Z',
          questionsCompletedAt: null,
        },
      ],
    })
    seedSession({ userId: TEST_IDS.user, businessId: TEST_IDS.business })

    renderHome()

    expect(await screen.findByTestId('signup-details-target')).toBeInTheDocument()
  })

  it('shows campaign dashboard when lead campaigns exist', async () => {
    hoisted.mockListBusinessContexts.mockResolvedValue({
      businessContexts: [
        {
          businessId: TEST_IDS.business,
          userId: TEST_IDS.user,
          websiteUrl: 'https://acme.example',
          businessName: 'Acme',
          industry: null,
          services: ['Plumbing'],
          serviceAreas: ['Austin'],
          contactMethods: null,
          audienceSignals: null,
          goals: { primary: 'forms' },
          differentiators: null,
          orderValueHint: null,
          thankYouUrls: [],
          uvp: null,
          competitorLandscape: null,
          businessScope: null,
          valueComplexity: null,
          budgetTier: null,
          susoVersion: 1,
          susoVersionUpdatedAt: '2026-01-01T00:00:00.000Z',
          confirmedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    })
    hoisted.mockGetLeadCampaignDashboard.mockResolvedValue({
      businessId: TEST_IDS.business,
      slots: {
        recommended: {
          slot: 'recommended',
          offer: 'Plumbing',
          action: 'forms',
          reviewStatus: 'approved',
          liveStatus: 'PAUSED',
        },
        alternative: null,
      },
    })
    seedSession({ userId: TEST_IDS.user, businessId: TEST_IDS.business })

    renderHome()

    expect(await screen.findByRole('heading', { name: /acme/i })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: /recommended/i })).toBeInTheDocument()
  })

  it('shows waiting message when intake is complete', async () => {
    hoisted.mockListBusinessContexts.mockResolvedValue({
      businessContexts: [
        {
          businessId: TEST_IDS.business,
          userId: TEST_IDS.user,
          websiteUrl: null,
          businessName: 'Acme',
          industry: null,
          services: ['Plumbing'],
          serviceAreas: ['Austin'],
          contactMethods: null,
          audienceSignals: null,
          goals: { primary: 'forms' },
          differentiators: null,
          orderValueHint: null,
          thankYouUrls: [],
          uvp: null,
          competitorLandscape: null,
          businessScope: null,
          valueComplexity: null,
          budgetTier: null,
          susoVersion: 1,
          susoVersionUpdatedAt: '2026-01-01T00:00:00.000Z',
          confirmedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    })
    seedSession({ userId: TEST_IDS.user, businessId: TEST_IDS.business })

    renderHome()

    expect(await screen.findByRole('heading', { name: /^thank you$/i })).toBeInTheDocument()
    expect(screen.getByText(/we'll call you to take this forward/i)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /continue setup/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /change your answers/i })).toBeInTheDocument()
  })

  it('prefers confirmed business over stale stored unconfirmed draft', async () => {
    const confirmedId = TEST_IDS.business
    const draftId = '507f1f77bcf86cd799439022'
    hoisted.mockListBusinessContexts.mockResolvedValue({
      businessContexts: [
        {
          businessId: draftId,
          userId: TEST_IDS.user,
          websiteUrl: null,
          businessName: 'Draft',
          industry: null,
          services: [],
          serviceAreas: [],
          contactMethods: null,
          audienceSignals: null,
          goals: null,
          differentiators: null,
          orderValueHint: null,
          thankYouUrls: [],
          uvp: null,
          competitorLandscape: null,
          businessScope: null,
          valueComplexity: null,
          budgetTier: null,
          susoVersion: 0,
          susoVersionUpdatedAt: null,
          confirmedAt: null,
        },
        {
          businessId: confirmedId,
          userId: TEST_IDS.user,
          websiteUrl: null,
          businessName: 'Acme',
          industry: null,
          services: ['Plumbing'],
          serviceAreas: ['Austin'],
          contactMethods: null,
          audienceSignals: null,
          goals: { primary: 'forms' },
          differentiators: null,
          orderValueHint: null,
          thankYouUrls: [],
          uvp: null,
          competitorLandscape: null,
          businessScope: null,
          valueComplexity: null,
          budgetTier: null,
          susoVersion: 1,
          susoVersionUpdatedAt: '2026-01-01T00:00:00.000Z',
          confirmedAt: '2026-01-02T00:00:00.000Z',
        },
      ],
    })
    seedSession({ userId: TEST_IDS.user, businessId: draftId })
    hoisted.mockAuthMe.mockResolvedValue({
      user: {
        id: TEST_IDS.user,
        email: 'owner@example.com',
        name: 'Owner',
        primaryBusinessId: draftId,
      },
    })

    renderHome()

    expect(await screen.findByRole('heading', { name: /^thank you$/i })).toBeInTheDocument()
  })

  it('fails safe to Get started when multiple businesses are unmatched', async () => {
    hoisted.mockListBusinessContexts.mockResolvedValue({
      businessContexts: [
        {
          businessId: '507f1f77bcf86cd799439021',
          userId: TEST_IDS.user,
          websiteUrl: null,
          businessName: 'Alpha',
          industry: null,
          services: [],
          serviceAreas: [],
          contactMethods: null,
          audienceSignals: null,
          goals: null,
          differentiators: null,
          orderValueHint: null,
          thankYouUrls: [],
          uvp: null,
          competitorLandscape: null,
          businessScope: null,
          valueComplexity: null,
          budgetTier: null,
          susoVersion: 0,
          susoVersionUpdatedAt: null,
          confirmedAt: null,
        },
        {
          businessId: '507f1f77bcf86cd799439022',
          userId: TEST_IDS.user,
          websiteUrl: null,
          businessName: 'Beta',
          industry: null,
          services: [],
          serviceAreas: [],
          contactMethods: null,
          audienceSignals: null,
          goals: null,
          differentiators: null,
          orderValueHint: null,
          thankYouUrls: [],
          uvp: null,
          competitorLandscape: null,
          businessScope: null,
          valueComplexity: null,
          budgetTier: null,
          susoVersion: 0,
          susoVersionUpdatedAt: null,
          confirmedAt: null,
        },
      ],
    })
    hoisted.mockAuthMe.mockResolvedValue({
      user: {
        id: TEST_IDS.user,
        email: 'owner@example.com',
        name: 'Owner',
        primaryBusinessId: null,
      },
    })

    renderHome()

    expect(await screen.findByRole('link', { name: /get started/i })).toBeInTheDocument()
    await waitFor(() => {
      expect(listBusinessContexts).toHaveBeenCalled()
    })
  })
})
