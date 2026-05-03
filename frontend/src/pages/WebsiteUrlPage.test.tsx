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
          <Route path="/register" element={<div data-testid="register-target">register</div>} />
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

  it('redirects when user id missing', async () => {
    renderSuggestions()

    await waitFor(() => {
      expect(screen.getByTestId('register-target')).toBeInTheDocument()
    })
  })

  it('redirects when scrape preview missing', async () => {
    seedSession({ userId: TEST_IDS.user, businessId: TEST_IDS.business })

    renderSuggestions()

    await waitFor(() => {
      expect(screen.getByTestId('business-target')).toBeInTheDocument()
    })
  })

  it('lists suggestion fields and navigates to review', async () => {
    seedSession({
      userId: TEST_IDS.user,
      businessId: TEST_IDS.business,
      scrapePreview: {
        websiteUrl: 'https://shop.example',
        suggested: {
          businessName: 'ShopCo',
          industry: 'Retail',
          services: ['a', 'b'],
          serviceAreas: ['north'],
          differentiators: 'Fast',
          orderValueHint: '50',
        },
      },
    })

    renderSuggestions()

    await screen.findByRole('heading', { name: /suggested business details/i })
    expect(screen.getByText('https://shop.example')).toBeInTheDocument()
    expect(screen.getByText('ShopCo')).toBeInTheDocument()
    expect(screen.getByText('Retail')).toBeInTheDocument()
    expect(screen.getByText('a')).toBeInTheDocument()
    expect(screen.getByText('Fast')).toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: /review & edit details/i }))

    await waitFor(() => {
      expect(screen.getByTestId('review-target')).toBeInTheDocument()
    })
  })

  it('renders dashes when suggestion fields are absent', async () => {
    seedSession({
      userId: TEST_IDS.user,
      businessId: TEST_IDS.business,
      scrapePreview: {
        websiteUrl: 'https://minimal.example',
        suggested: {},
      },
    })

    renderSuggestions()

    await screen.findByRole('heading', { name: /suggested business details/i })
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(4)
  })
})
