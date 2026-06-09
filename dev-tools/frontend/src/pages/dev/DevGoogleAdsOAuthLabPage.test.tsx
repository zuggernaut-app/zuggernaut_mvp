import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DevGoogleAdsOAuthLabPage } from './DevGoogleAdsOAuthLabPage'

vi.mock('../../api/dev/devIntegrations', () => ({
  isDevIntegrationsEnabled: vi.fn(),
}))

vi.mock('../../api/dev/googleAdsOAuthLab', () => ({
  createSandboxBusiness: vi.fn(),
  fetchGoogleAdsOAuthLabConnectUrl: vi.fn(),
  fetchGoogleAdsResourceOptions: vi.fn(),
  runGoogleAdsOAuthTrace: vi.fn(),
  runGoogleAdsMccLink: vi.fn(),
  runGoogleAdsReadWriteTest: vi.fn(),
}))

import { isDevIntegrationsEnabled } from '../../api/dev/devIntegrations'
import * as labApi from '../../api/dev/googleAdsOAuthLab'

describe('DevGoogleAdsOAuthLabPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows disabled message when flag is off', () => {
    vi.mocked(isDevIntegrationsEnabled).mockReturnValue(false)
    render(
      <MemoryRouter>
        <DevGoogleAdsOAuthLabPage />
      </MemoryRouter>,
    )
    expect(screen.getByText(/disabled/i)).toBeInTheDocument()
  })

  it('renders OAuth actions and stage log after trace', async () => {
    vi.mocked(isDevIntegrationsEnabled).mockReturnValue(true)
    vi.mocked(labApi.createSandboxBusiness).mockResolvedValue({
      businessId: 'abc123',
      created: true,
      businessName: 'Sandbox',
      confirmedAt: new Date().toISOString(),
    })
    vi.mocked(labApi.fetchGoogleAdsResourceOptions).mockResolvedValue({
      result: {
        businessId: 'abc123',
        provider: 'google_ads',
        selectionRequired: true,
        reason: 'ADS_CUSTOMER_SELECTION_REQUIRED',
        options: [
          {
            customerId: '2940178860',
            formattedCustomerId: '294-017-8860',
            descriptiveName: 'MCC',
            kind: 'manager',
            status: 'enabled',
            testAccount: false,
            selectable: false,
            nonSelectableReason: null,
            loginCustomerId: '2940178860',
          },
          {
            customerId: '7809414862',
            formattedCustomerId: '780-941-4862',
            descriptiveName: 'Client',
            kind: 'client',
            status: 'enabled',
            testAccount: false,
            selectable: true,
            nonSelectableReason: null,
            loginCustomerId: '2940178860',
          },
        ],
        selected: null,
        accessibleCustomerIds: ['2940178860', '7809414862'],
        loginCustomerId: '2940178860',
      },
    })
    vi.mocked(labApi.runGoogleAdsOAuthTrace).mockResolvedValue({
      result: {
        provider: 'google_ads',
        businessId: 'abc123',
        userId: 'user1',
        returnPath: '/dev/integrations/googleads',
        oauthLikelyComplete: true,
        connectUrl: null,
        firstFailure: {
          id: 'list_accessible_customers',
          label: 'List accessible customers',
          ok: false,
          detail: 'PERMISSION_DENIED',
          hint: 'Check developer token',
        },
        stages: [
          {
            id: 'environment',
            label: 'Environment',
            ok: true,
            detail: 'Required env vars present',
          },
          {
            id: 'list_accessible_customers',
            label: 'List accessible customers',
            ok: false,
            detail: 'PERMISSION_DENIED',
            hint: 'Check developer token',
          },
        ],
      },
    })

    render(
      <MemoryRouter>
        <DevGoogleAdsOAuthLabPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByText(/Sandbox business/i)).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /Run OAuth trace/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /OAuth trace log/i })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: /Link client account to MCC/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Check link status/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Run read tests/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Run write tests/i })).toBeInTheDocument()
    })
  })
})
