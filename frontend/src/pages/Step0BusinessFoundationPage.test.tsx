import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getBusinessContext, updateBusinessContext } from '../api/businessContexts'
import { AuthProvider } from '../hooks/useAuth'
import { OnboardingProvider } from '../hooks/useOnboardingState'
import { TEST_IDS, seedSession } from '../test/pageTestUtils'
import { Step0BusinessFoundationPage } from './Step0BusinessFoundationPage'

vi.mock('../api/businessContexts', () => ({
  getBusinessContext: vi.fn(),
  updateBusinessContext: vi.fn(),
}))

const hoisted = vi.hoisted(() => ({
  mockAuthMe: vi.fn(),
  mockFetchSoftLaunchSettings: vi.fn(),
}))

vi.mock('../api/auth', () => ({
  authMe: hoisted.mockAuthMe,
  authRegister: vi.fn(),
  authLogin: vi.fn(),
  authLogout: vi.fn().mockResolvedValue({ ok: true }),
}))

vi.mock('../api/settings', () => ({
  fetchSoftLaunchSettings: hoisted.mockFetchSoftLaunchSettings,
}))

const mockedGet = vi.mocked(getBusinessContext)
const mockedUpdate = vi.mocked(updateBusinessContext)

function renderStep0(initialEntry = '/onboarding/step-0'): ReturnType<typeof render> {
  hoisted.mockAuthMe.mockResolvedValue({
    user: { id: TEST_IDS.user, email: 'whoever@example.com', name: 'Who' },
  })
  hoisted.mockFetchSoftLaunchSettings.mockResolvedValue({ softLaunchMode: false })

  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthProvider>
        <OnboardingProvider>
          <Routes>
            <Route path="/onboarding/step-0" element={<Step0BusinessFoundationPage />} />
            <Route
              path="/onboarding/business"
              element={<div data-testid="business-target">business</div>}
            />
            <Route path="/setup" element={<div data-testid="setup-target">setup</div>} />
          </Routes>
        </OnboardingProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('Step0BusinessFoundationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedSession({})
    mockedGet.mockResolvedValue({
      businessContext: {
        businessId: TEST_IDS.business,
        uvp: '',
        competitorLandscape: { competitors: [] },
        businessScope: null,
        valueComplexity: null,
        budgetTier: null,
      },
      adsReadiness: { ok: true },
      susoMatrix: null,
    })
    mockedUpdate.mockResolvedValue({
      businessContext: {
        businessId: TEST_IDS.business,
        uvp: 'Fast local plumbing',
        businessScope: 'local_service',
        valueComplexity: 'low_value_low_complexity',
        budgetTier: 'growth',
      },
      susoMatrix: {
        cells: [],
        gates: [],
        ctaStyle: 'buy_now',
      },
    })
  })

  it('renders UVP textarea after load', async () => {
    seedSession({ userId: TEST_IDS.user, businessId: TEST_IDS.business })
    renderStep0()

    expect(await screen.findByLabelText(/unique value proposition/i)).toBeInTheDocument()
  })

  it('redirects to business onboarding when businessId is missing', async () => {
    seedSession({})
    renderStep0()

    expect(await screen.findByTestId('business-target')).toBeInTheDocument()
  })

  it('submits required fields and calls updateBusinessContext', async () => {
    seedSession({ userId: TEST_IDS.user, businessId: TEST_IDS.business })
    const user = userEvent.setup()
    renderStep0()

    await screen.findByLabelText(/unique value proposition/i)
    await user.type(screen.getByLabelText(/unique value proposition/i), 'Fast local plumbing')
    await user.selectOptions(screen.getByLabelText(/business scope/i), 'local_service')
    await user.selectOptions(
      screen.getByLabelText(/order value × technical complexity/i),
      'low_value_low_complexity',
    )
    await user.selectOptions(screen.getByLabelText(/budget tier/i), 'growth')
    await user.click(screen.getByRole('button', { name: /continue to setup/i }))

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith(
        TEST_IDS.business,
        expect.objectContaining({
          uvp: 'Fast local plumbing',
          businessScope: 'local_service',
          valueComplexity: 'low_value_low_complexity',
          budgetTier: 'growth',
        }),
      )
    })
    expect(await screen.findByTestId('setup-target')).toBeInTheDocument()
  })
})
