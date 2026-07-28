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

vi.mock('../api/businessContexts', () => ({
  getBusinessContext: vi.fn().mockResolvedValue({
    businessContext: { businessId: '507f1f77bcf86cd799439011', confirmedAt: new Date().toISOString() },
    adsReadiness: { ok: true },
  }),
}))

vi.mock('../components/integrations/GtmResourceSelector', () => ({
  GtmResourceSelector: () => <div>GTM selector panel</div>,
}))

vi.mock('../components/integrations/GoogleAdsCustomerSelector', () => ({
  GoogleAdsCustomerSelector: () => <div>Ads selector panel</div>,
}))

vi.mock('../components/integrations/MccLinkPanel', () => ({
  MccLinkPanel: ({ customerId }: { customerId: string }) => (
    <div data-testid="mcc-link-panel">MCC panel for {customerId}</div>
  ),
}))

const mockUseIntegrationConnections = vi.mocked(useIntegrationConnections)

function mockConnections(overrides: Partial<ReturnType<typeof useIntegrationConnections>> = {}) {
  mockUseIntegrationConnections.mockReturnValue({
    connections: {
      gbp: { provider: 'gbp', ready: false, reason: 'missing_connection' } as never,
      gtm: { provider: 'gtm', ready: false, reason: 'missing_connection' } as never,
      google_ads: { provider: 'google_ads', ready: false, reason: 'missing_connection' } as never,
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

  it('enables start setup when google ads is ready (GTM optional)', async () => {
    mockConnections({
      connections: {
        gbp: { provider: 'gbp', ready: false, reason: 'missing_connection' } as never,
        gtm: { provider: 'gtm', ready: false, reason: 'missing_connection' } as never,
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

  it('enables start setup when google ads needs provisioning approval', async () => {
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

  it('allows start setup when only GTM selection is pending', async () => {
    mockConnections({
      connections: {
        gbp: { provider: 'gbp', ready: false, reason: 'missing_connection' } as never,
        gtm: { provider: 'gtm', ready: false, reason: 'selection_required' } as never,
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

    expect(await screen.findByRole('button', { name: /start setup/i })).toBeEnabled()
    expect(screen.getByText(/GTM is recommended/i)).toBeInTheDocument()
    expect(screen.getByText('GTM selector panel')).toBeInTheDocument()
  })

  it('shows Ads selector when Google Ads selection is required', async () => {
    mockConnections({
      connections: {
        gbp: { provider: 'gbp', ready: false, reason: 'missing_connection' } as never,
        gtm: { provider: 'gtm', ready: true, reason: 'ok' } as never,
        google_ads: { provider: 'google_ads', ready: false, reason: 'selection_required' } as never,
      },
    })

    render(
      <MemoryRouter initialEntries={['/setup']}>
        <OnboardingProvider>
          <StartSetupPage />
        </OnboardingProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByText('Ads selector panel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /start setup/i })).toBeDisabled()
  })

  it('allows start setup when only optional GTM needs reauth', async () => {
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

    expect(await screen.findByRole('button', { name: /start setup/i })).toBeEnabled()
  })

  it('blocks start setup when google ads needs reauth', async () => {
    mockConnections({
      connections: {
        gtm: { provider: 'gtm', ready: true, reason: 'ok' } as never,
        google_ads: { provider: 'google_ads', ready: false, reason: 'needs_reauth' } as never,
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

  it('blocks start setup when MCC link is pending', async () => {
    mockConnections({
      connections: {
        gbp: { provider: 'gbp', ready: false, reason: 'missing_connection' } as never,
        gtm: { provider: 'gtm', ready: true, reason: 'ok' } as never,
        google_ads: {
          provider: 'google_ads',
          ready: false,
          reason: 'mcc_link_pending',
          providerIdentifiers: { customerId: '1234567890' },
        } as never,
      },
    })

    render(
      <MemoryRouter initialEntries={['/setup']}>
        <OnboardingProvider>
          <StartSetupPage />
        </OnboardingProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('mcc-link-panel')).toHaveTextContent('1234567890')
    expect(screen.getByRole('button', { name: /start setup/i })).toBeDisabled()
    expect(
      screen.getByText(/Link your selected Google Ads account to the Zuggernaut MCC/i),
    ).toBeInTheDocument()
  })

  it('enables start setup when active MCC link matches selected customer', async () => {
    mockConnections({
      connections: {
        gbp: { provider: 'gbp', ready: false, reason: 'missing_connection' } as never,
        gtm: { provider: 'gtm', ready: true, reason: 'ok' } as never,
        google_ads: {
          provider: 'google_ads',
          ready: true,
          reason: 'ok',
          providerIdentifiers: { customerId: '1234567890' },
        } as never,
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
    expect(screen.getByTestId('mcc-link-panel')).toHaveTextContent('1234567890')
  })

  it('updates MCC panel when selected customer changes', async () => {
    mockConnections({
      connections: {
        gbp: { provider: 'gbp', ready: false, reason: 'missing_connection' } as never,
        gtm: { provider: 'gtm', ready: true, reason: 'ok' } as never,
        google_ads: {
          provider: 'google_ads',
          ready: false,
          reason: 'mcc_link_required',
          providerIdentifiers: { customerId: '1111111111' },
        } as never,
      },
    })

    const view = render(
      <MemoryRouter initialEntries={['/setup']}>
        <OnboardingProvider>
          <StartSetupPage />
        </OnboardingProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('mcc-link-panel')).toHaveTextContent('1111111111')

    mockConnections({
      connections: {
        gbp: { provider: 'gbp', ready: false, reason: 'missing_connection' } as never,
        gtm: { provider: 'gtm', ready: true, reason: 'ok' } as never,
        google_ads: {
          provider: 'google_ads',
          ready: false,
          reason: 'mcc_link_required',
          providerIdentifiers: { customerId: '2222222222' },
        } as never,
      },
    })

    view.rerender(
      <MemoryRouter initialEntries={['/setup']}>
        <OnboardingProvider>
          <StartSetupPage />
        </OnboardingProvider>
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('mcc-link-panel')).toHaveTextContent('2222222222')
  })
})
