import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { OnboardingProvider } from '../hooks/useOnboardingState'
import { TEST_IDS, seedSession } from '../test/pageTestUtils'
import { WebsiteUrlPage } from './WebsiteUrlPage'

function renderSuggestions(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/onboarding/suggestions']}>
      <OnboardingProvider>
        <Routes>
          <Route path="/onboarding/suggestions" element={<WebsiteUrlPage />} />
          <Route
            path="/onboarding/business"
            element={<div data-testid="business-target">business</div>}
          />
          <Route path="/onboarding/review" element={<div data-testid="review-target">review</div>} />
        </Routes>
      </OnboardingProvider>
    </MemoryRouter>,
  )
}

describe('WebsiteUrlPage', () => {
  beforeEach(() => {
    seedSession({})
  })

  it('redirects when scrape preview is missing', async () => {
    seedSession({ userId: TEST_IDS.user, businessId: TEST_IDS.business })

    renderSuggestions()

    await waitFor(() => {
      expect(screen.getByTestId('business-target')).toBeInTheDocument()
    })
  })

  it('shows weak scrape warning and navigates to review', async () => {
    seedSession({
      userId: TEST_IDS.user,
      businessId: TEST_IDS.business,
      scrapePreview: {
        websiteUrl: 'https://weak.example',
        scrapeStatus: 'PARTIAL',
        scrapeQuality: 'weak',
        suggested: {
          businessName: 'Weak Co',
          services: [],
          contactMethods: { emails: ['hi@weak.example'] },
        },
      },
    })

    const user = userEvent.setup()
    renderSuggestions()

    await screen.findByRole('heading', { name: /suggested business details/i })
    expect(screen.getByText(/limited data was extracted/i)).toBeInTheDocument()
    expect(screen.getByText('Weak Co')).toBeInTheDocument()
    expect(screen.getByText(/hi@weak.example/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /review & edit details/i }))

    await waitFor(() => {
      expect(screen.getByTestId('review-target')).toBeInTheDocument()
    })
  })
})
