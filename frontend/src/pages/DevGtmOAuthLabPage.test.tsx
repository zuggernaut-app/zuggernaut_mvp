import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { DevGtmOAuthLabPage } from './DevGtmOAuthLabPage'

vi.mock('../api/devIntegrations', () => ({
  isDevIntegrationsEnabled: vi.fn(),
}))

vi.mock('../api/gtmOAuthLab', () => ({
  createSandboxBusiness: vi.fn(),
  fetchGtmOAuthLabConnectUrl: vi.fn(),
  fetchGtmResourceOptions: vi.fn(),
  runGtmOAuthTrace: vi.fn(),
  runGtmReadWriteTest: vi.fn(),
  saveGtmSelection: vi.fn(),
}))

import { isDevIntegrationsEnabled } from '../api/devIntegrations'
import * as labApi from '../api/gtmOAuthLab'

describe('DevGtmOAuthLabPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows disabled message when flag is off', () => {
    vi.mocked(isDevIntegrationsEnabled).mockReturnValue(false)
    render(
      <MemoryRouter>
        <DevGtmOAuthLabPage />
      </MemoryRouter>,
    )
    expect(screen.getByText(/disabled/i)).toBeInTheDocument()
  })

  it('renders GTM OAuth actions after bootstrap', async () => {
    vi.mocked(isDevIntegrationsEnabled).mockReturnValue(true)
    vi.mocked(labApi.createSandboxBusiness).mockResolvedValue({
      businessId: 'abc123',
      created: true,
      businessName: 'Sandbox',
      confirmedAt: new Date().toISOString(),
    })
    vi.mocked(labApi.fetchGtmResourceOptions).mockResolvedValue({
      result: {
        businessId: 'abc123',
        provider: 'gtm',
        selectionRequired: true,
        reason: 'GTM_SELECTION_REQUIRED',
        accounts: [
          {
            accountId: '1',
            name: 'Test Account',
            path: 'accounts/1',
            containers: [
              {
                containerId: '2',
                publicContainerId: 'GTM-TEST',
                name: 'Web',
                path: 'accounts/1/containers/2',
                usageContext: ['web'],
                workspaces: [{ workspaceId: '3', name: 'Default', path: 'accounts/1/containers/2/workspaces/3' }],
              },
            ],
          },
        ],
        selected: null,
      },
    })

    render(
      <MemoryRouter>
        <DevGtmOAuthLabPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Connect \(OAuth\)/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Run read tests/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Run write tests/i })).toBeInTheDocument()
    })
  })
})
