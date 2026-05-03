import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RequireAuth } from '../app/RequireAuth'
import { createBusinessDraft, scrapeBusiness, waitForScrapeCompletion } from '../api/onboarding'
import { ApiError } from '../api/client'
import { AuthProvider } from '../hooks/useAuth'
import { OnboardingProvider } from '../hooks/useOnboardingState'
import { TEST_IDS, seedSession } from '../test/pageTestUtils'
import { BusinessStartPage } from './BusinessStartPage'

vi.mock('../api/onboarding', () => ({
  createBusinessDraft: vi.fn(),
  scrapeBusiness: vi.fn(),
  waitForScrapeCompletion: vi.fn(),
}))

const hoisted = vi.hoisted(() => ({
  mockAuthMe: vi.fn(),
}))

vi.mock('../api/auth', () => ({
  authMe: hoisted.mockAuthMe,
  authRegister: vi.fn(),
  authLogin: vi.fn(),
  authLogout: vi.fn().mockResolvedValue({ ok: true }),
}))

const mockedDraft = vi.mocked(createBusinessDraft)
const mockedScrape = vi.mocked(scrapeBusiness)
const mockedWait = vi.mocked(waitForScrapeCompletion)

function renderBusinessStart(userIdSeed = TEST_IDS.user): ReturnType<typeof render> {
  hoisted.mockAuthMe.mockResolvedValue({
    user: {
      id: userIdSeed,
      email: 'whoever@example.com',
      name: 'Who',
    },
  })

  const view = render(
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
            <Route path="/login" element={<div data-testid="login-target">login</div>} />
            <Route
              path="/onboarding/suggestions"
              element={<div data-testid="suggestions-target">suggestions</div>}
            />
          </Routes>
        </OnboardingProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
  return view
}

async function bootstrapBusinessUi(): Promise<void> {
  await screen.findByRole('heading', { name: /your website/i })
}

describe('BusinessStartPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockAuthMe.mockResolvedValue({
      user: { id: TEST_IDS.user, email: 'whoever@example.com', name: 'Who' },
    })
    seedSession({})
  })

  it('redirects to login when there is no session', async () => {
    hoisted.mockAuthMe.mockRejectedValueOnce(new ApiError(401, 'no', 'unauthorized'))
    seedSession({})
    renderBusinessStart()

    await waitFor(() => {
      expect(screen.getByTestId('login-target')).toBeInTheDocument()
    })
  })

  it('shows URL validation error without calling API', async () => {
    seedSession({ userId: TEST_IDS.user })

    const user = userEvent.setup()
    renderBusinessStart()
    await bootstrapBusinessUi()

    await user.type(screen.getByLabelText(/website url/i), 'ftp://bad.example')
    await user.click(screen.getByRole('button', { name: /scrape suggestions/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/http/i)
    expect(mockedDraft).not.toHaveBeenCalled()
    expect(mockedScrape).not.toHaveBeenCalled()
  })

  it('creates draft, scrapes, stores preview, and navigates', async () => {
    seedSession({ userId: TEST_IDS.user })

    mockedDraft.mockResolvedValueOnce({ businessId: TEST_IDS.business })
    mockedScrape.mockResolvedValueOnce({
      businessId: TEST_IDS.business,
      websiteUrl: 'https://example.com',
      scrapeRunId: '507f1f77bcf86cd799439011',
      workflowId: 'wf-1',
      status: 'RUNNING',
    })
    mockedWait.mockResolvedValueOnce({
      websiteUrl: 'https://example.com',
      suggested: { businessName: 'Ex' },
    })

    const user = userEvent.setup()
    renderBusinessStart()
    await bootstrapBusinessUi()

    await user.type(screen.getByLabelText(/website url/i), 'https://example.com')
    await user.click(screen.getByRole('button', { name: /scrape suggestions/i }))

    await waitFor(() => {
      expect(screen.getByTestId('suggestions-target')).toBeInTheDocument()
    })

    expect(mockedDraft).toHaveBeenCalledTimes(1)
    expect(mockedScrape).toHaveBeenCalledWith(TEST_IDS.business, 'https://example.com')
    expect(mockedWait).toHaveBeenCalledWith(TEST_IDS.business, '507f1f77bcf86cd799439011')

    const raw = localStorage.getItem('zuggernaut:scrapePreview')
    expect(raw).toBeTruthy()
    expect(JSON.parse(raw as string)).toMatchObject({
      websiteUrl: 'https://example.com',
      suggested: { businessName: 'Ex' },
    })
    expect(localStorage.getItem('zuggernaut:businessId')).toBe(TEST_IDS.business)
  })

  it('skips draft when business id already in session', async () => {
    seedSession({
      userId: TEST_IDS.user,
      businessId: TEST_IDS.business,
    })

    mockedScrape.mockResolvedValueOnce({
      businessId: TEST_IDS.business,
      websiteUrl: 'https://example.com',
      scrapeRunId: '507f1f77bcf86cd799439012',
      workflowId: 'wf-1',
      status: 'RUNNING',
    })
    mockedWait.mockResolvedValueOnce({
      websiteUrl: 'https://example.com',
      suggested: {},
    })

    const user = userEvent.setup()
    renderBusinessStart()
    await bootstrapBusinessUi()

    await user.type(screen.getByLabelText(/website url/i), 'https://example.com')
    await user.click(screen.getByRole('button', { name: /scrape suggestions/i }))

    await waitFor(() => {
      expect(screen.getByTestId('suggestions-target')).toBeInTheDocument()
    })

    expect(mockedDraft).not.toHaveBeenCalled()
    expect(mockedScrape).toHaveBeenCalledTimes(1)
  })

  it('shows ApiError message when scrape fails', async () => {
    seedSession({ userId: TEST_IDS.user })

    mockedDraft.mockResolvedValueOnce({ businessId: TEST_IDS.business })
    mockedScrape.mockRejectedValueOnce(new ApiError(404, 'Not found', 'not_found'))

    const user = userEvent.setup()
    renderBusinessStart()
    await bootstrapBusinessUi()

    await user.type(screen.getByLabelText(/website url/i), 'https://example.com')
    await user.click(screen.getByRole('button', { name: /scrape suggestions/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Not found')
  })
})
