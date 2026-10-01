import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RequireAuth } from '../app/RequireAuth'
import { createBusinessDraft, scrapeBusiness, submitIntake } from '../api/onboarding'
import { ApiError } from '../api/client'
import { AuthProvider } from '../hooks/useAuth'
import { OnboardingProvider } from '../hooks/useOnboardingState'
import { TEST_IDS, seedSession } from '../test/pageTestUtils'
import { setIntakeDraft } from '../utils/storage'
import { BusinessStartPage } from './BusinessStartPage'

const hoisted = vi.hoisted(() => ({
  mockAuthMe: vi.fn(),
  mockUseIntegrationConnections: vi.fn(),
  mockGetBusinessContext: vi.fn(),
}))

vi.mock('../api/onboarding', () => ({
  createBusinessDraft: vi.fn(),
  getOnboardingScrapeSuggestions: vi.fn().mockResolvedValue({ suggested: null, status: null }),
  scrapeBusiness: vi.fn(),
  submitIntake: vi.fn(),
}))

vi.mock('../api/businessContexts', () => ({
  getBusinessContext: hoisted.mockGetBusinessContext,
}))

vi.mock('../api/auth', () => ({
  authMe: hoisted.mockAuthMe,
  authRegister: vi.fn(),
  authLogin: vi.fn(),
  authLogout: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('../hooks/useIntegrationConnections', () => ({
  useIntegrationConnections: hoisted.mockUseIntegrationConnections,
}))

const mockedDraft = vi.mocked(createBusinessDraft)
const mockedScrape = vi.mocked(scrapeBusiness)
const mockedSubmitIntake = vi.mocked(submitIntake)
const mockedGetBusinessContext = hoisted.mockGetBusinessContext

const adsNotConnected = {
  connections: {},
  loading: false,
  error: null,
  refetch: vi.fn(),
  connectProvider: vi.fn(),
  providerLabels: { google_ads: 'Google Ads (required)' },
  statusLabel: () => 'Not connected',
  canAttemptSetup: () => false,
}

const adsReady = {
  connections: {
    google_ads: {
      provider: 'google_ads' as const,
      ready: true,
      reason: 'ready',
      connectionHealth: 'healthy',
      nextAction: null,
      scopesGranted: [],
      scopesMissing: [],
      providerIdentifiers: { customerId: '1234567890' },
    },
  },
  loading: false,
  error: null,
  refetch: vi.fn(),
  connectProvider: vi.fn(),
  providerLabels: { google_ads: 'Google Ads (required)' },
  statusLabel: () => 'Connected',
  canAttemptSetup: () => true,
}

function renderIntake(): ReturnType<typeof render> {
  hoisted.mockAuthMe.mockResolvedValue({
    user: {
      id: TEST_IDS.user,
      email: 'whoever@example.com',
      name: 'Who',
    },
  })

  return render(
    <MemoryRouter initialEntries={['/onboarding/business']}>
      <AuthProvider>
        <OnboardingProvider>
          <Routes>
            <Route
              path="/onboarding/business"
              element={
                <RequireAuth>
                  <BusinessStartPage />
                </RequireAuth>
              }
            />
            <Route
              path="/onboarding/thank-you"
              element={<div data-testid="thank-you-target">thank you</div>}
            />
            <Route
              path="/onboarding/review"
              element={<div data-testid="review-target">review</div>}
            />
            <Route
              path="/onboarding/suggestions"
              element={<div data-testid="suggestions-target">suggestions</div>}
            />
          </Routes>
        </OnboardingProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByLabelText(/website url/i), 'https://example.com')
  await user.type(screen.getByLabelText(/business name/i), 'Acme Plumbing')
  await user.type(screen.getByLabelText(/what you sell/i), 'Emergency plumbing')
  await user.type(screen.getByLabelText(/where you serve/i), 'Austin, TX')
  await user.type(screen.getByLabelText(/who buys from you today/i), 'Homeowners')
  await user.type(screen.getByLabelText(/how buyers contact you/i), 'Phone and form')
  await user.type(screen.getByLabelText(/^phone$/i), '555-123-4567')
  await user.type(screen.getByLabelText(/^email$/i), 'owner@acme.example')
}

describe('BusinessStartPage intake', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    seedSession({ userId: TEST_IDS.user, businessId: TEST_IDS.business })
    mockedGetBusinessContext.mockResolvedValue({
      businessContext: {
        businessId: TEST_IDS.business,
        userId: TEST_IDS.user,
        websiteUrl: null,
        businessName: 'Prefill From Server',
        industry: null,
        services: ['Should not show'],
        serviceAreas: ['Nowhere'],
        contactMethods: { emails: ['server@example.com'], phones: ['555-000-0000'] },
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
      adsReadiness: { ok: false, issues: [] },
      susoMatrix: { cells: [] },
    })
    hoisted.mockUseIntegrationConnections.mockReturnValue(adsNotConnected)
    mockedDraft.mockResolvedValue({ businessId: TEST_IDS.business })
    mockedSubmitIntake.mockResolvedValue({
      businessId: TEST_IDS.business,
      saved: true,
    })
    mockedScrape.mockResolvedValue({
      businessId: TEST_IDS.business,
      websiteUrl: 'https://example.com',
      scrapeRunId: '507f1f77bcf86cd799439099',
      workflowId: 'wf-1',
      status: 'RUNNING',
    })
  })

  it('keeps submit disabled until phone and email are valid', async () => {
    hoisted.mockUseIntegrationConnections.mockReturnValue(adsReady)
    const user = userEvent.setup()
    renderIntake()

    await screen.findByLabelText(/business name/i)
    await user.type(screen.getByLabelText(/business name/i), 'Acme Plumbing')
    await user.type(screen.getByLabelText(/what you sell/i), 'Emergency plumbing')
    await user.type(screen.getByLabelText(/where you serve/i), 'Austin, TX')

    expect(screen.getByRole('button', { name: /^submit$/i })).toBeDisabled()
    expect(mockedSubmitIntake).not.toHaveBeenCalled()
  })

  it('keeps submit disabled when Google Ads is not connected', async () => {
    const user = userEvent.setup()
    renderIntake()
    await screen.findByLabelText(/business name/i)
    await fillRequiredFields(user)

    expect(screen.getByRole('button', { name: /^submit$/i })).toBeDisabled()
    expect(mockedSubmitIntake).not.toHaveBeenCalled()
  })

  it('submits intake and navigates to thank-you without customer scrape', async () => {
    hoisted.mockUseIntegrationConnections.mockReturnValue(adsReady)
    const user = userEvent.setup()
    renderIntake()
    await screen.findByLabelText(/business name/i)
    await fillRequiredFields(user)
    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => {
      expect(screen.getByTestId('thank-you-target')).toBeInTheDocument()
    })

    expect(mockedSubmitIntake).toHaveBeenCalledWith(TEST_IDS.business, {
      websiteUrl: 'https://example.com',
      businessName: 'Acme Plumbing',
      phone: '555-123-4567',
      email: 'owner@acme.example',
      primaryOffer: 'Emergency plumbing',
      whoBuysToday: 'Homeowners',
      serviceArea: 'Austin, TX',
      howBuyersContact: 'Phone and form',
    })
    expect(mockedScrape).not.toHaveBeenCalled()
  })

  it('restores intake fields from sessionStorage after OAuth return', async () => {
    setIntakeDraft(TEST_IDS.business, {
      websiteUrl: 'https://saved.example',
      businessName: 'Saved Co',
      primaryOffer: 'Roofing',
      serviceArea: 'Denver, CO',
      phone: '555-987-6543',
      email: 'saved@example.com',
    })

    renderIntake()

    await waitFor(() => {
      expect(screen.getByLabelText(/business name/i)).toHaveValue('Saved Co')
    })
    expect(screen.getByLabelText(/website url/i)).toHaveValue('https://saved.example')
    expect(screen.getByLabelText(/what you sell/i)).toHaveValue('Roofing')
    expect(screen.getByLabelText(/where you serve/i)).toHaveValue('Denver, CO')
    expect(screen.getByLabelText(/^phone$/i)).toHaveValue('555-987-6543')
    expect(screen.getByLabelText(/^email$/i)).toHaveValue('saved@example.com')
  })

  it('persists intake fields before starting Google OAuth', async () => {
    const connectProvider = vi.fn()
    hoisted.mockUseIntegrationConnections.mockReturnValue({
      ...adsNotConnected,
      connections: {
        google_ads: {
          provider: 'google_ads' as const,
          ready: false,
          reason: 'missing_connection',
          connectionHealth: null,
          nextAction: null,
          scopesGranted: [],
          scopesMissing: [],
          providerIdentifiers: null,
        },
      },
      connectProvider,
    })

    const user = userEvent.setup()
    renderIntake()
    await screen.findByLabelText(/business name/i)
    await user.type(screen.getByLabelText(/business name/i), 'Acme Plumbing')
    await user.type(screen.getByLabelText(/what you sell/i), 'Emergency plumbing')
    await user.click(screen.getByRole('button', { name: /connect google/i }))

    expect(connectProvider).toHaveBeenCalledWith('google_ads', '/onboarding/business')
    expect(sessionStorage.getItem(`zuggernaut:intakeDraft:${TEST_IDS.business}`)).toContain(
      'Acme Plumbing',
    )
  })

  it('redirects to thank-you when business context is already confirmed', async () => {
    mockedGetBusinessContext.mockResolvedValueOnce({
      businessContext: {
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
      adsReadiness: { ok: true },
      susoMatrix: { cells: [] },
    })

    renderIntake()

    await waitFor(() => {
      expect(screen.getByTestId('thank-you-target')).toBeInTheDocument()
    })
    expect(mockedSubmitIntake).not.toHaveBeenCalled()
  })

  it('does not prefill intake fields from getBusinessContext when unconfirmed', async () => {
    renderIntake()

    await waitFor(() => {
      expect(mockedGetBusinessContext).toHaveBeenCalledWith(TEST_IDS.business)
    })
    expect(screen.getByLabelText(/business name/i)).toHaveValue('')
    expect(screen.getByLabelText(/what you sell/i)).toHaveValue('')
  })

  it('recreates draft when stored businessId returns 404', async () => {
    const newBusinessId = '507f1f77bcf86cd799439099'
    mockedGetBusinessContext.mockRejectedValueOnce(
      new ApiError(404, 'Business context not found for this user', 'not_found'),
    )
    mockedDraft.mockResolvedValueOnce({ businessId: newBusinessId })
    mockedGetBusinessContext.mockResolvedValue({
      businessContext: {
        businessId: newBusinessId,
        userId: TEST_IDS.user,
        websiteUrl: null,
        businessName: null,
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
      adsReadiness: { ok: false, issues: [] },
      susoMatrix: { cells: [] },
    })

    renderIntake()

    await waitFor(() => {
      expect(mockedDraft).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(mockedGetBusinessContext).toHaveBeenCalledWith(newBusinessId)
    })
  })

  it('does not navigate to review or suggestions', async () => {
    hoisted.mockUseIntegrationConnections.mockReturnValue(adsReady)
    const user = userEvent.setup()
    renderIntake()
    await screen.findByLabelText(/business name/i)
    await fillRequiredFields(user)
    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => {
      expect(screen.getByTestId('thank-you-target')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('review-target')).not.toBeInTheDocument()
    expect(screen.queryByTestId('suggestions-target')).not.toBeInTheDocument()
  })
})
