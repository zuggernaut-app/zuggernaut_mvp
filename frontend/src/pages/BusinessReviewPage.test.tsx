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
        services: [],
        serviceAreas: [],
        contactMethods: null,
        audienceSignals: null,
        goals: null,
        differentiators: null,
        orderValueHint: null,
        confirmedAt: new Date().toISOString(),
      },
    })

    const user = userEvent.setup()
    renderReview()

    await screen.findByRole('heading', { name: /confirm business context/i })

    await user.clear(screen.getByLabelText(/^business name$/i))
    await user.type(screen.getByLabelText(/^business name$/i), 'Acme LLC')

    await user.click(screen.getByRole('button', { name: /confirm & continue/i }))

    await waitFor(() => {
      expect(screen.getByTestId('setup-target')).toBeInTheDocument()
    })

    expect(mockedUpdate).toHaveBeenCalledWith(
      TEST_IDS.business,
      expect.objectContaining({
        businessName: 'Acme LLC',
        industry: 'Tech',
      }),
    )

    await waitFor(() => {
      expect(localStorage.getItem('zuggernaut:scrapePreview')).toBeNull()
    })
  })

  it('shows error when optional JSON field is invalid', async () => {
    seedSession({
      userId: TEST_IDS.user,
      businessId: TEST_IDS.business,
      scrapePreview: {
        websiteUrl: 'https://x.com',
        suggested: {},
      },
    })

    const user = userEvent.setup()
    renderReview()

    await screen.findByRole('heading', { name: /confirm business context/i })

    await user.click(screen.getByText(/optional json fields/i))

    fireEvent.change(screen.getByLabelText(/contactMethods \(JSON\)/i), {
      target: { value: '{broken' },
    })

    await user.click(screen.getByRole('button', { name: /confirm & continue/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/contact methods/i)
    expect(mockedUpdate).not.toHaveBeenCalled()
  })

  it('shows ApiError message when PUT fails', async () => {
    seedSession({
      userId: TEST_IDS.user,
      businessId: TEST_IDS.business,
      scrapePreview: { websiteUrl: 'https://x.com', suggested: {} },
    })

    mockedUpdate.mockRejectedValueOnce(new ApiError(400, 'Bad payload', 'validation_error'))

    const user = userEvent.setup()
    renderReview()

    await screen.findByRole('heading', { name: /confirm business context/i })
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
