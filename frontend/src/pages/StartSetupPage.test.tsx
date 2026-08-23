import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../api/client'
import { startSetupRun, getLatestSetupRun } from '../api/setupRuns'
import { OnboardingProvider } from '../hooks/useOnboardingState'
import { TEST_IDS, seedSession } from '../test/pageTestUtils'
import { StartSetupPage } from './StartSetupPage'

vi.mock('../api/setupRuns', () => ({
  startSetupRun: vi.fn(),
  getLatestSetupRun: vi.fn().mockResolvedValue({ setupRun: null }),
}))

vi.mock('../api/businessContexts', () => ({
  getBusinessContext: vi.fn().mockResolvedValue({
    businessContext: {
      businessId: '507f1f77bcf86cd799439011',
      confirmedAt: new Date().toISOString(),
    },
    adsReadiness: { ok: true },
  }),
}))

vi.mock('../hooks/useIntegrationConnections', () => ({
  useIntegrationConnections: vi.fn(() => ({
    connections: {
      gtm: { provider: 'gtm', ready: true, reason: 'ok' },
      google_ads: { provider: 'google_ads', ready: true, reason: 'ok' },
      gbp: { provider: 'gbp', ready: false, reason: 'missing_connection' },
    },
    loading: false,
    error: null,
    refetch: vi.fn(),
    connectProvider: vi.fn(),
    providerLabels: {
      gbp: 'Google Business Profile (optional)',
      gtm: 'Google Tag Manager (optional, recommended)',
      google_ads: 'Google Ads (required)',
    },
    statusLabel: (s: { ready: boolean }) => (s.ready ? 'Connected' : 'Not connected'),
    canAttemptSetup: (s: { ready: boolean; reason?: string } | undefined) =>
      Boolean(s?.ready || s?.reason === 'provisioning_required'),
  })),
  INTEGRATION_PROVIDERS: ['gbp', 'gtm', 'google_ads'],
}))

const mockedStart = vi.mocked(startSetupRun)
const mockedLatest = vi.mocked(getLatestSetupRun)

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
    mockedLatest.mockResolvedValue({ setupRun: null })
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
    expect(mockedStart).toHaveBeenCalledWith(TEST_IDS.business, undefined)
  })

  it('shows setup complete state and view report link', async () => {
    seedSession({
      userId: TEST_IDS.user,
      businessId: TEST_IDS.business,
    })
    mockedLatest.mockResolvedValueOnce({
      setupRun: { id: TEST_IDS.setupRun, status: 'SUCCEEDED', businessId: TEST_IDS.business },
    })

    renderStartSetup()

    expect(await screen.findByText(/setup complete/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view setup report/i })).toHaveAttribute(
      'href',
      `/setup/report/${TEST_IDS.setupRun}`,
    )
    expect(screen.getByRole('button', { name: /start new setup run/i })).toBeEnabled()
  })

  it('shows cancel-prior-run confirmation when force while RUNNING requires confirm', async () => {
    seedSession({
      userId: TEST_IDS.user,
      businessId: TEST_IDS.business,
    })
    mockedLatest.mockResolvedValue({
      setupRun: { id: TEST_IDS.setupRun, status: 'RUNNING', businessId: TEST_IDS.business },
    })
    mockedStart
      .mockRejectedValueOnce(
        new ApiError(409, 'A setup run is already in progress.', 'setup_in_progress', {
          error: 'setup_in_progress',
          message:
            'A setup run is already in progress. Confirm cancellation of the prior run before forcing a new start.',
          setupRunId: TEST_IDS.setupRun,
          cancelPriorRunRequired: true,
          workflowId: `setup-run-${TEST_IDS.setupRun}`,
        }),
      )
      .mockResolvedValueOnce({
        setupRunId: 'new-run-id',
        workflowId: 'wf-3',
        status: 'RUNNING',
      })

    const user = userEvent.setup()
    renderStartSetup()

    const cancelButton = await screen.findByRole('button', { name: /cancel and start new run/i })
    await user.click(cancelButton)

    expect(
      await screen.findByRole('heading', { name: /cancel the in-progress setup/i }),
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /yes, cancel and start new run/i }))

    await waitFor(() => {
      expect(mockedStart).toHaveBeenNthCalledWith(1, TEST_IDS.business, { force: true })
      expect(mockedStart).toHaveBeenNthCalledWith(2, TEST_IDS.business, {
        force: true,
        confirmCancelPriorRun: true,
      })
    })
  })

  it('shows re-run confirmation modal after complete', async () => {
    seedSession({
      userId: TEST_IDS.user,
      businessId: TEST_IDS.business,
    })
    mockedLatest.mockResolvedValue({
      setupRun: { id: TEST_IDS.setupRun, status: 'SUCCEEDED', businessId: TEST_IDS.business },
    })
    mockedStart.mockResolvedValueOnce({
      setupRunId: 'new-run-id',
      workflowId: 'wf-2',
      status: 'RUNNING',
    })

    const user = userEvent.setup()
    renderStartSetup()

    const rerunButton = await screen.findByRole('button', { name: /start new setup run/i })
    await user.click(rerunButton)

    expect(await screen.findByRole('heading', { name: /start a new setup run/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /yes, start new run/i }))

    await waitFor(() => {
      expect(mockedStart).toHaveBeenCalledWith(TEST_IDS.business, { force: true })
    })
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
