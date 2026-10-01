import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RequireAuth } from '../app/RequireAuth'
import { getOnboardingScrapeSuggestions, submitIntake } from '../api/onboarding'
import { ApiError } from '../api/client'
import { AuthProvider } from '../hooks/useAuth'
import { OnboardingProvider } from '../hooks/useOnboardingState'
import { TEST_IDS, seedSession } from '../test/pageTestUtils'
import { setIntakeDraft } from '../utils/storage'
import { BusinessStartPage } from './BusinessStartPage'

const hoisted = vi.hoisted(() => ({
  mockAuthMe: vi.fn(),
  mockGetBusinessContext: vi.fn(),
}))

vi.mock('../api/onboarding', () => ({
  getOnboardingScrapeSuggestions: vi.fn().mockResolvedValue({ suggested: null, status: null }),
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

const mockedSubmitIntake = vi.mocked(submitIntake)
const mockedGetBusinessContext = hoisted.mockGetBusinessContext

const baseContext = {
  businessId: TEST_IDS.business,
  userId: TEST_IDS.user,
  websiteUrl: 'https://example.com',
  businessName: null,
  industry: null,
  services: [],
  serviceAreas: [],
  contactMethods: { emails: ['owner@acme.example'], phones: ['555-123-4567'] },
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
              path="/onboarding/accounts"
              element={<div data-testid="accounts-target">accounts</div>}
            />
            <Route
              path="/onboarding/thank-you"
              element={<div data-testid="thank-you-target">thank you</div>}
            />
          </Routes>
        </OnboardingProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('BusinessStartPage intake', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sessionStorage.clear()
    seedSession({ userId: TEST_IDS.user, businessId: TEST_IDS.business })
    mockedGetBusinessContext.mockResolvedValue({
      businessContext: baseContext,
      adsReadiness: { ok: false, issues: [] },
      susoMatrix: { cells: [] },
    })
    mockedSubmitIntake.mockResolvedValue({
      businessId: TEST_IDS.business,
      saved: true,
    })
  })

  it('allows submit with optional empty fields', async () => {
    const user = userEvent.setup()
    renderIntake()

    await screen.findByLabelText(/business name/i)
    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => {
      expect(screen.getByTestId('thank-you-target')).toBeInTheDocument()
    })

    expect(mockedSubmitIntake).toHaveBeenCalledWith(TEST_IDS.business, {
      businessName: '',
      primaryOffer: '',
      whoBuysToday: '',
      serviceArea: '',
      howBuyersContact: '',
    })
  })

  it('submits filled question fields', async () => {
    const user = userEvent.setup()
    renderIntake()
    await screen.findByLabelText(/business name/i)
    await user.type(screen.getByLabelText(/business name/i), 'Acme Plumbing')
    await user.type(screen.getByLabelText(/what you sell/i), 'Emergency plumbing')
    await user.type(screen.getByLabelText(/where you serve/i), 'Austin, TX')
    await user.type(screen.getByLabelText(/who buys from you today/i), 'Homeowners')
    await user.type(screen.getByLabelText(/how buyers contact you/i), 'Phone and form')
    await user.click(screen.getByRole('button', { name: /^submit$/i }))

    await waitFor(() => {
      expect(screen.getByTestId('thank-you-target')).toBeInTheDocument()
    })

    expect(mockedSubmitIntake).toHaveBeenCalledWith(TEST_IDS.business, {
      businessName: 'Acme Plumbing',
      primaryOffer: 'Emergency plumbing',
      whoBuysToday: 'Homeowners',
      serviceArea: 'Austin, TX',
      howBuyersContact: 'Phone and form',
    })
  })

  it('restores intake fields from sessionStorage', async () => {
    setIntakeDraft(TEST_IDS.business, {
      businessName: 'Saved Co',
      primaryOffer: 'Roofing',
      serviceArea: 'Denver, CO',
      whoBuysToday: '',
      orderValueHint: '',
      howBuyersContact: '',
    })

    renderIntake()

    await waitFor(() => {
      expect(screen.getByLabelText(/business name/i)).toHaveValue('Saved Co')
    })
    expect(screen.getByLabelText(/what you sell/i)).toHaveValue('Roofing')
    expect(screen.getByLabelText(/where you serve/i)).toHaveValue('Denver, CO')
  })

  it('redirects to thank-you when business context is already confirmed', async () => {
    mockedGetBusinessContext.mockResolvedValueOnce({
      businessContext: {
        ...baseContext,
        confirmedAt: '2026-01-02T00:00:00.000Z',
        questionsCompletedAt: '2026-01-02T00:00:00.000Z',
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

  it('redirects to accounts when account links are not complete', async () => {
    mockedGetBusinessContext.mockResolvedValueOnce({
      businessContext: {
        ...baseContext,
        accountLinksCompletedAt: null,
      },
      adsReadiness: { ok: false, issues: [] },
      susoMatrix: { cells: [] },
    })

    renderIntake()

    await waitFor(() => {
      expect(screen.getByTestId('accounts-target')).toBeInTheDocument()
    })
  })

  it('redirects to accounts when stored businessId returns 404', async () => {
    mockedGetBusinessContext.mockRejectedValueOnce(
      new ApiError(404, 'Business context not found for this user', 'not_found'),
    )

    renderIntake()

    await waitFor(() => {
      expect(screen.getByTestId('accounts-target')).toBeInTheDocument()
    })
  })

  it('loads signup scrape hints when available on mount', async () => {
    vi.mocked(getOnboardingScrapeSuggestions).mockResolvedValueOnce({
      suggested: { businessName: 'Hint Co', services: ['Plumbing'] },
      status: 'SUCCEEDED',
    })

    renderIntake()

    await waitFor(() => {
      expect(screen.getByText('Hint Co')).toBeInTheDocument()
    })
  })
})
