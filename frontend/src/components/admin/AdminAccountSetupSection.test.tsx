import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createProvisioningRequest,
  fetchGoogleConnectUrl,
  fetchIntegrationStatus,
  fetchProvisioningOverview,
} from '../../api/integrations'
import { AdminAccountSetupSection } from './AdminAccountSetupSection'
import { TEST_IDS } from '../../test/pageTestUtils'

vi.mock('../../api/integrations', () => ({
  fetchIntegrationStatus: vi.fn(),
  fetchGoogleConnectUrl: vi.fn(),
  fetchProvisioningOverview: vi.fn(),
  createProvisioningRequest: vi.fn(),
}))

const mockedStatus = vi.mocked(fetchIntegrationStatus)
const mockedConnectUrl = vi.mocked(fetchGoogleConnectUrl)
const mockedProvisioningOverview = vi.mocked(fetchProvisioningOverview)
const mockedCreateProvisioningRequest = vi.mocked(createProvisioningRequest)

describe('AdminAccountSetupSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedProvisioningOverview.mockResolvedValue({
      businessId: TEST_IDS.business,
      providers: {
        gtm: {
          provider: 'gtm',
          connection: {
            provider: 'gtm',
            ready: true,
            reason: 'ready',
            connectionHealth: 'connected',
            nextAction: null,
            scopesGranted: [],
            scopesMissing: [],
            providerIdentifiers: null,
          },
          activeRequest: null,
          latestRequest: null,
          provisioningRequired: false,
        },
        google_ads: {
          provider: 'google_ads',
          connection: {
            provider: 'google_ads',
            ready: false,
            reason: 'provisioning_required',
            connectionHealth: 'provisioning_required',
            nextAction: null,
            scopesGranted: [],
            scopesMissing: [],
            providerIdentifiers: null,
          },
          activeRequest: null,
          latestRequest: null,
          provisioningRequired: true,
        },
      },
    })
    mockedCreateProvisioningRequest.mockResolvedValue({
      created: true,
      request: {
        id: 'req-1',
        businessId: TEST_IDS.business,
        provider: 'google_ads',
        status: 'pending_approval',
        requestedResources: ['google_ads_customer'],
        approvedAt: null,
        createdProviderIdentifiers: null,
        errorCode: null,
        errorMessage: null,
        setupRunId: null,
        currencyCode: 'USD',
      },
    })
    mockedConnectUrl.mockResolvedValue({
      provider: 'google_ads',
      businessId: TEST_IDS.business,
      url: 'https://accounts.google.com/o/oauth2/auth',
    })
  })

  it('loads integration status without rediscover', async () => {
    mockedStatus.mockResolvedValue({
      businessId: TEST_IDS.business,
      connections: {
        google_ads: {
          provider: 'google_ads',
          ready: true,
          reason: 'connected',
          connectionHealth: 'connected',
          nextAction: null,
          scopesGranted: [],
          scopesMissing: [],
          providerIdentifiers: { customerId: '1234567890' },
        },
      },
    })

    render(
      <AdminAccountSetupSection
        businessId={TEST_IDS.business}
        returnPath={`/admin/businesses/${TEST_IDS.business}`}
      />,
    )

    await waitFor(() => {
      expect(mockedStatus).toHaveBeenCalledWith(TEST_IDS.business)
    })
    expect(screen.getByText(/customer id: 1234567890/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /reconnect/i })).not.toBeInTheDocument()
  })

  it('shows reconnect when token repair is required', async () => {
    mockedStatus.mockResolvedValue({
      businessId: TEST_IDS.business,
      connections: {
        google_ads: {
          provider: 'google_ads',
          ready: false,
          reason: 'needs_reauth',
          connectionHealth: 'needs_reauth',
          nextAction: null,
          scopesGranted: [],
          scopesMissing: [],
          providerIdentifiers: { customerId: '1234567890' },
        },
      },
    })

    const user = userEvent.setup()
    const assignMock = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, assign: assignMock },
    })

    render(
      <AdminAccountSetupSection
        businessId={TEST_IDS.business}
        returnPath={`/admin/businesses/${TEST_IDS.business}`}
      />,
    )

    const button = await screen.findByRole('button', {
      name: /reconnect — restore this account/i,
    })
    await user.click(button)

    await waitFor(() => {
      expect(mockedConnectUrl).toHaveBeenCalledWith(
        'google_ads',
        TEST_IDS.business,
        `/admin/businesses/${TEST_IDS.business}`,
      )
    })
    expect(assignMock).toHaveBeenCalledWith('https://accounts.google.com/o/oauth2/auth')
  })
})
