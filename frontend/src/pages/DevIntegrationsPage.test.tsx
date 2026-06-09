import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DevIntegrationsPage } from './DevIntegrationsPage'

vi.mock('../api/devIntegrations', () => ({
  isDevIntegrationsEnabled: vi.fn(),
  createSandboxBusiness: vi.fn(),
  fetchDiagnosticsOverview: vi.fn(),
  fetchGoogleAdsResourceOptions: vi.fn(),
  fetchGtmResourceOptions: vi.fn(),
  saveGoogleAdsSelection: vi.fn(),
  saveGtmSelection: vi.fn(),
  fetchDevGoogleConnectUrl: vi.fn(),
  runProviderSmokeTest: vi.fn(),
  fetchProvisioningCheck: vi.fn(),
  startDevScrape: vi.fn(),
  waitForDevScrapeCompletion: vi.fn(),
  runGtmCreationDiagnostics: vi.fn(),
  runGoogleAdsCreationDiagnostics: vi.fn(),
  fetchDiagnosticRun: vi.fn(),
}))

import * as devApi from '../api/devIntegrations'

describe('DevIntegrationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows disabled message when flag is off', () => {
    vi.mocked(devApi.isDevIntegrationsEnabled).mockReturnValue(false)
    render(
      <MemoryRouter>
        <DevIntegrationsPage />
      </MemoryRouter>,
    )
    expect(screen.getByText(/disabled/i)).toBeInTheDocument()
  })

  it('renders provider cards when enabled', async () => {
    vi.mocked(devApi.isDevIntegrationsEnabled).mockReturnValue(true)
    vi.mocked(devApi.createSandboxBusiness).mockResolvedValue({
      businessId: 'abc123',
      created: true,
      businessName: 'Sandbox',
      confirmedAt: new Date().toISOString(),
    })
    vi.mocked(devApi.fetchGoogleAdsResourceOptions).mockResolvedValue({
      result: {
        businessId: 'abc123',
        provider: 'google_ads',
        selectionRequired: true,
        reason: 'ADS_CUSTOMER_SELECTION_REQUIRED',
        options: [],
        selected: null,
        accessibleCustomerIds: [],
        loginCustomerId: null,
      },
    })
    vi.mocked(devApi.fetchGtmResourceOptions).mockResolvedValue({
      result: {
        businessId: 'abc123',
        provider: 'gtm',
        selectionRequired: true,
        reason: 'GTM_RESOURCE_SELECTION_REQUIRED',
        accounts: [],
        selected: null,
      },
    })
    vi.mocked(devApi.fetchDiagnosticsOverview).mockResolvedValue({
      businessId: 'abc123',
      connections: {
        google_ads: {
          provider: 'google_ads',
          ready: false,
          reason: 'selection_required',
          connectionHealth: 'selection_required',
          nextAction: 'select_google_ads_customer',
          scopesGranted: ['https://www.googleapis.com/auth/adwords'],
          scopesMissing: [],
          providerIdentifiers: { accessibleCustomerIds: ['1234567890'] },
        },
        gtm: {
          provider: 'gtm',
          ready: false,
          reason: 'selection_required',
          connectionHealth: 'selection_required',
          nextAction: 'select_gtm_container',
          scopesGranted: [
            'https://www.googleapis.com/auth/tagmanager.edit.containers',
            'https://www.googleapis.com/auth/tagmanager.publish',
            'https://www.googleapis.com/auth/tagmanager.manage.accounts',
          ],
          scopesMissing: [],
          providerIdentifiers: { discoveredAccountCount: 1 },
        },
        gbp: {
          provider: 'gbp',
          ready: false,
          reason: 'missing_connection',
          connectionHealth: null,
          nextAction: 'connect_gbp',
          scopesGranted: [],
          scopesMissing: [],
          providerIdentifiers: null,
        },
      },
      provisioning: {},
      environment: {
        googleOAuthMock: true,
        gtmApiMock: true,
        googleAdsApiMock: true,
        gbpApiMock: true,
        gtmApiEnabled: true,
        googleAdsApiEnabled: true,
        gbpApiEnabled: true,
      },
    })

    render(
      <MemoryRouter>
        <DevIntegrationsPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Google Ads')).toBeInTheDocument()
    expect(screen.getByText('Google Tag Manager')).toBeInTheDocument()
    expect(screen.getByText('Google Business Profile')).toBeInTheDocument()
    expect(screen.getByText('Website scrape')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /scrape website/i })).toBeInTheDocument()
    expect(screen.getByText('External creation diagnostics')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /run google ads creation diagnostic/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /run gtm creation diagnostic/i })).toBeInTheDocument()
    expect(screen.getByText('Google Ads account selection')).toBeInTheDocument()
    expect(screen.getByText('GTM resource selection')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /run google ads creation diagnostic/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /run gtm creation diagnostic/i })).toBeDisabled()
  })

  it('disables cancelled Google Ads accounts and saves active client selection', async () => {
    const user = userEvent.setup()
    vi.mocked(devApi.isDevIntegrationsEnabled).mockReturnValue(true)
    vi.mocked(devApi.createSandboxBusiness).mockResolvedValue({
      businessId: 'abc123',
      created: true,
      businessName: 'Sandbox',
      confirmedAt: new Date().toISOString(),
    })
    vi.mocked(devApi.fetchGoogleAdsResourceOptions).mockResolvedValue({
      result: {
        businessId: 'abc123',
        provider: 'google_ads',
        selectionRequired: true,
        reason: 'ADS_CUSTOMER_SELECTION_REQUIRED',
        options: [
          {
            customerId: '7809414862',
            formattedCustomerId: '780-941-4862',
            descriptiveName: 'Active Client',
            kind: 'client',
            status: 'enabled',
            testAccount: false,
            selectable: true,
            nonSelectableReason: null,
            loginCustomerId: null,
          },
          {
            customerId: '6314301557',
            formattedCustomerId: '631-430-1557',
            descriptiveName: 'Cancelled',
            kind: 'client',
            status: 'cancelled',
            testAccount: false,
            selectable: false,
            nonSelectableReason: 'Cancelled Google Ads accounts cannot be used for setup.',
            loginCustomerId: null,
          },
        ],
        selected: null,
        accessibleCustomerIds: ['7809414862', '6314301557'],
        loginCustomerId: null,
      },
    })
    vi.mocked(devApi.fetchGtmResourceOptions).mockResolvedValue({
      result: {
        businessId: 'abc123',
        provider: 'gtm',
        selectionRequired: true,
        reason: 'GTM_RESOURCE_SELECTION_REQUIRED',
        accounts: [],
        selected: null,
      },
    })
    vi.mocked(devApi.fetchDiagnosticsOverview).mockResolvedValue({
      businessId: 'abc123',
      connections: {
        google_ads: {
          provider: 'google_ads',
          ready: false,
          reason: 'selection_required',
          connectionHealth: 'selection_required',
          nextAction: 'select_google_ads_customer',
          scopesGranted: ['https://www.googleapis.com/auth/adwords'],
          scopesMissing: [],
          providerIdentifiers: { accessibleCustomerIds: ['7809414862', '6314301557'] },
        },
        gtm: {
          provider: 'gtm',
          ready: false,
          reason: 'missing_connection',
          connectionHealth: null,
          nextAction: 'connect_gtm',
          scopesGranted: [],
          scopesMissing: [],
          providerIdentifiers: null,
        },
        gbp: {
          provider: 'gbp',
          ready: false,
          reason: 'missing_connection',
          connectionHealth: null,
          nextAction: 'connect_gbp',
          scopesGranted: [],
          scopesMissing: [],
          providerIdentifiers: null,
        },
      },
      provisioning: {},
      environment: {
        googleOAuthMock: true,
        gtmApiMock: true,
        googleAdsApiMock: true,
        gbpApiMock: true,
        gtmApiEnabled: true,
        googleAdsApiEnabled: true,
        gbpApiEnabled: true,
      },
    })
    vi.mocked(devApi.saveGoogleAdsSelection).mockResolvedValue({
      result: {
        businessId: 'abc123',
        provider: 'google_ads',
        selectionRequired: false,
        selected: {
          customerId: '7809414862',
          formattedCustomerId: '780-941-4862',
          descriptiveName: 'Active Client',
          kind: 'client',
          status: 'enabled',
          selectedAt: new Date().toISOString(),
        },
      },
    })

    render(
      <MemoryRouter>
        <DevIntegrationsPage />
      </MemoryRouter>,
    )

    const cancelledRadio = await screen.findByRole('radio', { name: /cancelled/i })
    expect(cancelledRadio).toBeDisabled()

    const activeRadio = screen.getByRole('radio', { name: /active client/i })
    await user.click(activeRadio)

    await user.click(screen.getByRole('button', { name: /save google ads selection/i }))

    await waitFor(() => {
      expect(devApi.saveGoogleAdsSelection).toHaveBeenCalledWith('abc123', '7809414862')
    })
  })

  it('shows GTM account/container/workspace picker and saves selection', async () => {
    const user = userEvent.setup()
    vi.mocked(devApi.isDevIntegrationsEnabled).mockReturnValue(true)
    vi.mocked(devApi.createSandboxBusiness).mockResolvedValue({
      businessId: 'abc123',
      created: true,
      businessName: 'Sandbox',
      confirmedAt: new Date().toISOString(),
    })
    vi.mocked(devApi.fetchGoogleAdsResourceOptions).mockResolvedValue({
      result: {
        businessId: 'abc123',
        provider: 'google_ads',
        selectionRequired: false,
        reason: null,
        options: [],
        selected: null,
        accessibleCustomerIds: [],
        loginCustomerId: null,
      },
    })
    vi.mocked(devApi.fetchGtmResourceOptions).mockResolvedValue({
      result: {
        businessId: 'abc123',
        provider: 'gtm',
        selectionRequired: true,
        reason: 'GTM_RESOURCE_SELECTION_REQUIRED',
        accounts: [
          {
            accountId: 'acct-1',
            name: 'Test Account',
            path: 'accounts/acct-1',
            containers: [
              {
                containerId: 'ctr-1',
                publicContainerId: 'GTM-TEST',
                name: 'Web Container',
                path: 'accounts/acct-1/containers/ctr-1',
                usageContext: ['web'],
                workspaces: [
                  {
                    workspaceId: 'ws-1',
                    name: 'Default Workspace',
                    path: 'accounts/acct-1/containers/ctr-1/workspaces/ws-1',
                  },
                ],
              },
            ],
          },
        ],
        selected: null,
      },
    })
    vi.mocked(devApi.fetchDiagnosticsOverview).mockResolvedValue({
      businessId: 'abc123',
      connections: {
        google_ads: {
          provider: 'google_ads',
          ready: false,
          reason: 'missing_connection',
          connectionHealth: null,
          nextAction: 'connect_google_ads',
          scopesGranted: [],
          scopesMissing: [],
          providerIdentifiers: null,
        },
        gtm: {
          provider: 'gtm',
          ready: false,
          reason: 'selection_required',
          connectionHealth: 'selection_required',
          nextAction: 'select_gtm_container',
          scopesGranted: [
            'https://www.googleapis.com/auth/tagmanager.edit.containers',
            'https://www.googleapis.com/auth/tagmanager.publish',
            'https://www.googleapis.com/auth/tagmanager.manage.accounts',
          ],
          scopesMissing: [],
          providerIdentifiers: { discoveredAccountCount: 1 },
        },
        gbp: {
          provider: 'gbp',
          ready: false,
          reason: 'missing_connection',
          connectionHealth: null,
          nextAction: 'connect_gbp',
          scopesGranted: [],
          scopesMissing: [],
          providerIdentifiers: null,
        },
      },
      provisioning: {},
      environment: {
        googleOAuthMock: true,
        gtmApiMock: true,
        googleAdsApiMock: true,
        gbpApiMock: true,
        gtmApiEnabled: true,
        googleAdsApiEnabled: true,
        gbpApiEnabled: true,
      },
    })
    vi.mocked(devApi.saveGtmSelection).mockResolvedValue({
      result: {
        businessId: 'abc123',
        provider: 'gtm',
        selectionRequired: false,
        selected: {
          accountId: 'acct-1',
          accountName: 'Test Account',
          containerId: 'ctr-1',
          containerName: 'Web Container',
          publicContainerId: 'GTM-TEST',
          workspaceId: 'ws-1',
          workspaceName: 'Default Workspace',
          selectedAt: new Date().toISOString(),
        },
      },
    })

    render(
      <MemoryRouter>
        <DevIntegrationsPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('GTM resource selection')).toBeInTheDocument()
    expect(screen.getByText(/GTM-TEST/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /save gtm selection/i }))

    await waitFor(() => {
      expect(devApi.saveGtmSelection).toHaveBeenCalledWith('abc123', {
        accountId: 'acct-1',
        containerId: 'ctr-1',
        workspaceId: 'ws-1',
      })
    })
  })
})
