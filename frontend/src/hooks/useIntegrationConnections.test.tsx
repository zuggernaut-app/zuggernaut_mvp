import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useIntegrationConnections } from '../hooks/useIntegrationConnections'
import { StartSetupPage } from '../pages/StartSetupPage'
import { OnboardingProvider } from '../hooks/useOnboardingState'
import { seedSession } from '../test/pageTestUtils'
import { integrationStatusLabel } from '../lib/provisioningUi'

vi.mock('../hooks/useIntegrationConnections', () => ({
  useIntegrationConnections: vi.fn(),
  INTEGRATION_PROVIDERS: ['gbp', 'gtm', 'google_ads'],
}))

const mockUseIntegrationConnections = vi.mocked(useIntegrationConnections)

function mockConnections(overrides: Partial<ReturnType<typeof useIntegrationConnections>> = {}) {
  mockUseIntegrationConnections.mockReturnValue({
    connections: {},
    loading: false,
    error: null,
    refetch: vi.fn(),
    connectProvider: vi.fn(),
    providerLabels: {
      gbp: 'Google Business Profile (optional)',
      gtm: 'Google Tag Manager (required)',
      google_ads: 'Google Ads (required)',
    },
    statusLabel: integrationStatusLabel,
    canAttemptSetup: (s) => Boolean(s?.ready || s?.reason === 'provisioning_required'),
    ...overrides,
  })
}

describe('StartSetupPage integrations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedSession({ businessId: '507f1f77bcf86cd799439011' })
    mockConnections()
  })

  it('disables start setup until required providers are connected', async () => {
    render(
      <MemoryRouter initialEntries={['/setup']}>
        <OnboardingProvider>
          <StartSetupPage />
        </OnboardingProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('button', { name: /start setup/i })).toBeDisabled()
    expect(screen.getAllByRole('button', { name: /connect google/i }).length).toBeGreaterThan(0)
  })

  it('enables start setup when gtm and google ads are ready', async () => {
    mockConnections({
      connections: {
        gbp: { provider: 'gbp', ready: false, reason: 'missing_connection' } as never,
        gtm: { provider: 'gtm', ready: true, reason: 'ok' } as never,
        google_ads: { provider: 'google_ads', ready: true, reason: 'ok' } as never,
      },
    })

    render(
      <MemoryRouter initialEntries={['/setup']}>
        <OnboardingProvider>
          <StartSetupPage />
        </OnboardingProvider>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start setup/i })).toBeEnabled()
    })
  })

  it('enables start setup when required providers need provisioning approval', async () => {
    mockConnections({
      connections: {
        gbp: { provider: 'gbp', ready: false, reason: 'missing_connection' } as never,
        gtm: { provider: 'gtm', ready: false, reason: 'provisioning_required' } as never,
        google_ads: { provider: 'google_ads', ready: false, reason: 'provisioning_required' } as never,
      },
    })

    render(
      <MemoryRouter initialEntries={['/setup']}>
        <OnboardingProvider>
          <StartSetupPage />
        </OnboardingProvider>
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start setup/i })).toBeEnabled()
    })
    expect(screen.getAllByText(/Provisioning approval needed/i).length).toBeGreaterThan(0)
  })

  it('still blocks start setup when a required provider is not connected', async () => {
    mockConnections({
      connections: {
        gbp: { provider: 'gbp', ready: false, reason: 'missing_connection' } as never,
        gtm: { provider: 'gtm', ready: false, reason: 'provisioning_required' } as never,
        google_ads: { provider: 'google_ads', ready: false, reason: 'missing_connection' } as never,
      },
    })

    render(
      <MemoryRouter initialEntries={['/setup']}>
        <OnboardingProvider>
          <StartSetupPage />
        </OnboardingProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('button', { name: /start setup/i })).toBeDisabled()
  })

  it('still blocks start setup when reauth is required', async () => {
    mockConnections({
      connections: {
        gtm: { provider: 'gtm', ready: false, reason: 'needs_reauth' } as never,
        google_ads: { provider: 'google_ads', ready: true, reason: 'ok' } as never,
      },
    })

    render(
      <MemoryRouter initialEntries={['/setup']}>
        <OnboardingProvider>
          <StartSetupPage />
        </OnboardingProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByRole('button', { name: /start setup/i })).toBeDisabled()
  })

  it('calls connectProvider when Connect Google is clicked', async () => {
    const connectProvider = vi.fn()
    mockConnections({ connectProvider })

    render(
      <MemoryRouter initialEntries={['/setup']}>
        <OnboardingProvider>
          <StartSetupPage />
        </OnboardingProvider>
      </MemoryRouter>,
    )

    const user = userEvent.setup()
    await user.click((await screen.findAllByRole('button', { name: /connect google/i }))[0])
    expect(connectProvider).toHaveBeenCalled()
  })
})
