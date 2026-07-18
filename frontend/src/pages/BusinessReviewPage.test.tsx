import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { updateBusinessContext } from '../api/businessContexts'
import { ApiError } from '../api/client'
import { OnboardingProvider } from '../hooks/useOnboardingState'
import { TEST_IDS, seedSession } from '../test/pageTestUtils'
import { BusinessReviewPage } from './BusinessReviewPage'

vi.mock('../api/businessContexts', () => ({
  updateBusinessContext: vi.fn(),
}))

const mockedUpdate = vi.mocked(updateBusinessContext)

function renderReview(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/onboarding/review']}>
      <OnboardingProvider>
        <Routes>
          <Route path="/onboarding/review" element={<BusinessReviewPage />} />
          <Route
            path="/onboarding/business"
            element={<div data-testid="business-target">business</div>}
          />
          <Route path="/setup" element={<div data-testid="setup-target">setup</div>} />
          <Route
            path="/onboarding/suggestions"
            element={<div data-testid="suggestions-target">suggestions</div>}
          />
        </Routes>
      </OnboardingProvider>
    </MemoryRouter>,
  )
}

describe('BusinessReviewPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedSession({})
  })

  it('redirects when prerequisites missing', async () => {
    seedSession({ userId: TEST_IDS.user })

    renderReview()

    await waitFor(() => {
      expect(screen.getByTestId('business-target')).toBeInTheDocument()
    })
  })

  it('submits context and navigates to setup', async () => {
    seedSession({
      userId: TEST_IDS.user,
      businessId: TEST_IDS.business,
      scrapePreview: {
        websiteUrl: 'https://seed.example',
        suggested: { businessName: 'SeedCo', industry: 'Tech' },
      },
    })

    mockedUpdate.mockResolvedValueOnce({
      businessContext: {
        businessId: TEST_IDS.business,
        userId: TEST_IDS.user,
        websiteUrl: 'https://seed.example',
        businessName: 'SeedCo',
        industry: 'Tech',
        services: ['Consulting'],
        serviceAreas: ['Metro area'],
        contactMethods: null,
        audienceSignals: null,
        goals: { primary: 'both' },
        differentiators: null,
        orderValueHint: null,
        confirmedAt: new Date().toISOString(),
      },
      adsReadiness: { ok: true },
    })

    const user = userEvent.setup()
    renderReview()

    await screen.findByRole('heading', { name: /confirm business context/i })

    await user.clear(screen.getByLabelText(/^business name$/i))
    await user.type(screen.getByLabelText(/^business name$/i), 'Acme LLC')
    await user.selectOptions(screen.getByLabelText(/^primary business goal$/i), 'both')
    await user.type(screen.getByLabelText(/^services/i), 'Consulting')
    await user.type(screen.getByLabelText(/^service areas/i), 'Metro area')

    await user.click(screen.getByRole('button', { name: /confirm & continue/i }))

    await waitFor(() => {
      expect(screen.getByTestId('setup-target')).toBeInTheDocument()
    })

    expect(mockedUpdate).toHaveBeenCalledWith(
      TEST_IDS.business,
      expect.objectContaining({
        businessName: 'Acme LLC',
        industry: 'Tech',
        goals: { primary: 'both' },
      }),
    )

    await waitFor(() => {
      expect(localStorage.getItem('zuggernaut:scrapePreview')).toBeNull()
    })
  })

  it('requires business name before save', async () => {
    seedSession({
      userId: TEST_IDS.user,
      businessId: TEST_IDS.business,
      scrapePreview: {
        websiteUrl: 'https://x.com',
        suggested: { businessName: 'Seed' },
      },
    })

    const user = userEvent.setup()
    renderReview()

    await screen.findByRole('heading', { name: /confirm business context/i })
    await user.clear(screen.getByLabelText(/^business name$/i))
    await user.click(screen.getByRole('button', { name: /confirm & continue/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/business name is required/i)
    expect(mockedUpdate).not.toHaveBeenCalled()
  })

  it('shows error when optional JSON field is invalid', async () => {
    seedSession({
      userId: TEST_IDS.user,
      businessId: TEST_IDS.business,
      scrapePreview: {
        websiteUrl: 'https://x.com',
        suggested: { businessName: 'X Co' },
      },
    })

    const user = userEvent.setup()
    renderReview()

    await screen.findByRole('heading', { name: /confirm business context/i })

    await user.click(screen.getByText(/optional json fields/i))

    fireEvent.change(screen.getByLabelText(/contactMethods/i), {
      target: { value: '{broken' },
    })
    await user.selectOptions(screen.getByLabelText(/^primary business goal$/i), 'both')

    await user.click(screen.getByRole('button', { name: /confirm & continue/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/contact methods/i)
    expect(mockedUpdate).not.toHaveBeenCalled()
  })

  it('uses dropdown primary goal over unsupported scraped goals JSON', async () => {
    seedSession({
      userId: TEST_IDS.user,
      businessId: TEST_IDS.business,
      scrapePreview: {
        websiteUrl: 'https://x.com',
        suggested: {
          businessName: 'X Co',
          industry: 'Plumbing',
          services: ['Plumbing'],
          serviceAreas: ['Springfield'],
          goals: { primary: 'generate_leads' },
        },
      },
    })

    mockedUpdate.mockResolvedValueOnce({
      businessContext: {
        businessId: TEST_IDS.business,
        userId: TEST_IDS.user,
        websiteUrl: 'https://x.com',
        businessName: 'X Co',
        industry: 'Plumbing',
        services: ['Plumbing'],
        serviceAreas: ['Springfield'],
        contactMethods: null,
        audienceSignals: null,
        goals: { primary: 'calls' },
        differentiators: null,
        orderValueHint: null,
        confirmedAt: new Date().toISOString(),
      },
      adsReadiness: { ok: true },
    })

    const user = userEvent.setup()
    renderReview()

    await screen.findByRole('heading', { name: /confirm business context/i })
    await user.selectOptions(screen.getByLabelText(/^primary business goal$/i), 'calls')
    await user.click(screen.getByRole('button', { name: /confirm & continue/i }))

    await waitFor(() => {
      expect(screen.getByTestId('setup-target')).toBeInTheDocument()
    })

    expect(mockedUpdate).toHaveBeenCalledWith(
      TEST_IDS.business,
      expect.objectContaining({
        goals: expect.objectContaining({ primary: 'calls' }),
      }),
    )
  })

  it('shows ApiError message when PUT fails', async () => {
    seedSession({
      userId: TEST_IDS.user,
      businessId: TEST_IDS.business,
      scrapePreview: { websiteUrl: 'https://x.com', suggested: { businessName: 'X Co' } },
    })

    mockedUpdate.mockRejectedValueOnce(new ApiError(400, 'Bad payload', 'validation_error'))

    const user = userEvent.setup()
    renderReview()

    await screen.findByRole('heading', { name: /confirm business context/i })
    await user.selectOptions(screen.getByLabelText(/^primary business goal$/i), 'both')
    await user.click(screen.getByRole('button', { name: /confirm & continue/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Bad payload')
  })

  it('navigates back to suggestions', async () => {
    seedSession({
      userId: TEST_IDS.user,
      businessId: TEST_IDS.business,
      scrapePreview: { websiteUrl: 'https://x.com', suggested: {} },
    })

    const user = userEvent.setup()
    renderReview()

    await screen.findByRole('heading', { name: /confirm business context/i })
    await user.click(screen.getByRole('button', { name: /^back$/i }))

    await waitFor(() => {
      expect(screen.getByTestId('suggestions-target')).toBeInTheDocument()
    })
  })
})
