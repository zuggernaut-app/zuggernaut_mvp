import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OnboardingProvider } from '../hooks/useOnboardingState'
import { TEST_IDS, seedSession } from '../test/pageTestUtils'
import { SetupProgressPage } from './SetupProgressPage'

const mockUseSetupRunStatus = vi.fn()

vi.mock('../hooks/useSetupRunStatus', () => ({
  useSetupRunStatus: (setupRunId: string | null) => mockUseSetupRunStatus(setupRunId),
}))

function defaultHookReturn() {
  return {
    data: null as null,
    loading: false,
    error: null as string | null,
    lastUpdatedAt: null as number | null,
    refetch: vi.fn(),
    appearsStuck: false,
    pollingPaused: false,
  }
}

function renderProgress(path: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <OnboardingProvider>
        <Routes>
          <Route path="/setup/progress/:setupRunId" element={<SetupProgressPage />} />
          <Route path="/setup/no-param" element={<SetupProgressPage />} />
          <Route path="/register" element={<div data-testid="register-target">register</div>} />
          <Route path="/setup" element={<div data-testid="setup-link-target">setup page</div>} />
        </Routes>
      </OnboardingProvider>
    </MemoryRouter>,
  )
}

describe('SetupProgressPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedSession({})
    mockUseSetupRunStatus.mockImplementation(() => defaultHookReturn())
  })

  it('redirects unauthenticated users to register', async () => {
    mockUseSetupRunStatus.mockReturnValue({
      ...defaultHookReturn(),
    })

    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    await waitFor(() => {
      expect(screen.getByTestId('register-target')).toBeInTheDocument()
    })
  })

  it('shows missing setup run message when no id', async () => {
    seedSession({ userId: TEST_IDS.user })

    renderProgress('/setup/no-param')

    expect(await screen.findByRole('alert')).toHaveTextContent(/missing setupRunId/i)
    expect(screen.getByRole('link', { name: /go to setup/i })).toHaveAttribute('href', '/setup')
  })

  it('renders status, steps, and stuck hint', async () => {
    seedSession({ userId: TEST_IDS.user })

    const refetch = vi.fn()
    mockUseSetupRunStatus.mockReturnValue({
      data: {
        setupRun: {
          id: TEST_IDS.setupRun,
          businessId: TEST_IDS.business,
          temporalWorkflowId: 'wf-z',
          status: 'RUNNING',
          lastErrorSummary: 'worker paused',
          meta: null,
        },
        steps: [
          {
            id: 'step1',
            stepName: 'alpha',
            provider: null,
            status: 'success',
            attemptCount: 1,
            startedAt: null,
            endedAt: null,
            lastErrorSummary: 'step busted',
            details: null,
          },
        ],
      },
      loading: false,
      error: null,
      lastUpdatedAt: 1_700_000_000_000,
      refetch,
      appearsStuck: true,
      pollingPaused: false,
    })

    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    await screen.findByText(TEST_IDS.setupRun)
    expect(screen.getByText('RUNNING')).toBeInTheDocument()
    expect(screen.getByText(/worker paused/i)).toBeInTheDocument()
    expect(screen.getByText(/looks stuck/i)).toBeInTheDocument()
    expect(screen.getByText(/step busted/i)).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /refresh now/i }))
    expect(refetch).toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /^refresh$/i }))
    expect(refetch).toHaveBeenCalledTimes(2)
  })

  it('shows hook error message', async () => {
    seedSession({ userId: TEST_IDS.user })

    mockUseSetupRunStatus.mockReturnValue({
      ...defaultHookReturn(),
      error: 'Could not load run',
      loading: false,
    })

    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load run')
  })

  it('persists route param setupRunId into session when mismatched', async () => {
    seedSession({
      userId: TEST_IDS.user,
      setupRunId: '507f1f77bcf86cd799439099',
    })

    mockUseSetupRunStatus.mockReturnValue(defaultHookReturn())

    renderProgress(`/setup/progress/${TEST_IDS.setupRun}`)

    await waitFor(() => {
      expect(localStorage.getItem('zuggernaut:setupRunId')).toBe(TEST_IDS.setupRun)
    })
  })
})
