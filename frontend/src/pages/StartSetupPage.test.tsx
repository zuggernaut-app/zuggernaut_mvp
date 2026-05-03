import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { startSetupRun } from '../api/setupRuns'
import { OnboardingProvider } from '../hooks/useOnboardingState'
import { TEST_IDS, seedSession } from '../test/pageTestUtils'
import { StartSetupPage } from './StartSetupPage'

vi.mock('../api/setupRuns', () => ({
  startSetupRun: vi.fn(),
}))

const mockedStart = vi.mocked(startSetupRun)

function renderStartSetup(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/setup']}>
      <OnboardingProvider>
        <Routes>
          <Route path="/setup" element={<StartSetupPage />} />
          <Route
            path="/onboarding/business"
            element={<div data-testid="business-target">business</div>}
          />
          <Route
            path="/setup/progress/:setupRunId"
            element={<div data-testid="progress-target">progress</div>}
          />
        </Routes>
      </OnboardingProvider>
    </MemoryRouter>,
  )
}

describe('StartSetupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedSession({})
  })

  it('shows the form when local session has businessId', async () => {
    seedSession({ businessId: TEST_IDS.business })

    renderStartSetup()

    expect(await screen.findByRole('heading', { name: /start setup run/i })).toBeInTheDocument()
  })

  it('redirects to business onboarding without business id', async () => {
    seedSession({ userId: TEST_IDS.user })

    renderStartSetup()

    await waitFor(() => {
      expect(screen.getByTestId('business-target')).toBeInTheDocument()
    })
  })

  it('starts setup and navigates to progress', async () => {
    seedSession({
      userId: TEST_IDS.user,
      businessId: TEST_IDS.business,
    })

    mockedStart.mockResolvedValueOnce({
      setupRunId: TEST_IDS.setupRun,
      workflowId: 'wf-1',
      status: 'RUNNING',
    })

    const user = userEvent.setup()
    renderStartSetup()

    await screen.findByRole('heading', { name: /start setup run/i })
    await user.click(screen.getByRole('button', { name: /start setup/i }))

    await waitFor(() => {
      expect(screen.getByTestId('progress-target')).toBeInTheDocument()
    })

    expect(localStorage.getItem('zuggernaut:setupRunId')).toBe(TEST_IDS.setupRun)
    expect(mockedStart).toHaveBeenCalledWith(TEST_IDS.business)
  })

  it('navigates on Temporal 503 when setupRunId is in error body', async () => {
    seedSession({
      userId: TEST_IDS.user,
      businessId: TEST_IDS.business,
    })

    mockedStart.mockRejectedValueOnce(
      new ApiError(503, 'Temporal unavailable', 'temporal_unavailable', {
        error: 'temporal_unavailable',
        message: 'Temporal unavailable',
        setupRunId: TEST_IDS.setupRun,
      }),
    )

    const user = userEvent.setup()
    renderStartSetup()

    await screen.findByRole('heading', { name: /start setup run/i })
    await user.click(screen.getByRole('button', { name: /start setup/i }))

    await waitFor(() => {
      expect(screen.getByTestId('progress-target')).toBeInTheDocument()
    })

    expect(localStorage.getItem('zuggernaut:setupRunId')).toBe(TEST_IDS.setupRun)
  })

  it('shows error when Temporal 503 returns no setupRunId', async () => {
    seedSession({
      userId: TEST_IDS.user,
      businessId: TEST_IDS.business,
    })

    mockedStart.mockRejectedValueOnce(
      new ApiError(503, 'Temporal unavailable', 'temporal_unavailable', {
        error: 'temporal_unavailable',
        message: 'Temporal unavailable',
      }),
    )

    const user = userEvent.setup()
    renderStartSetup()

    await screen.findByRole('heading', { name: /start setup run/i })
    await user.click(screen.getByRole('button', { name: /start setup/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/no setupRunId/i)
  })

  it('shows generic ApiError message for other failures', async () => {
    seedSession({
      userId: TEST_IDS.user,
      businessId: TEST_IDS.business,
    })

    mockedStart.mockRejectedValueOnce(new ApiError(409, 'Conflict here', 'precondition_failed'))

    const user = userEvent.setup()
    renderStartSetup()

    await screen.findByRole('heading', { name: /start setup run/i })
    await user.click(screen.getByRole('button', { name: /start setup/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Conflict here')
  })
})
