import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchGtmAccounts,
  fetchGtmResourceOptions,
  saveGtmAccountSelection,
  saveGtmSelection,
} from '../../api/integrations'
import { GtmResourceSelector } from './GtmResourceSelector'

vi.mock('../../api/integrations', () => ({
  fetchGtmResourceOptions: vi.fn(),
  fetchGtmAccounts: vi.fn(),
  saveGtmSelection: vi.fn(),
  saveGtmAccountSelection: vi.fn(),
}))

const mockedFetch = vi.mocked(fetchGtmResourceOptions)
const mockedFetchAccounts = vi.mocked(fetchGtmAccounts)
const mockedSave = vi.mocked(saveGtmSelection)
const mockedSaveAccount = vi.mocked(saveGtmAccountSelection)

describe('GtmResourceSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedFetch.mockResolvedValue({
      result: {
        businessId: 'bid',
        provider: 'gtm',
        selectionRequired: true,
        reason: 'GTM_RESOURCE_SELECTION_REQUIRED',
        accounts: [
          {
            accountId: 'mock-account',
            name: 'Mock Account',
            containers: [
              {
                containerId: 'mock-container',
                name: 'Web',
                publicContainerId: 'GTM-MOCK',
                usageContext: ['web'],
                workspaces: [{ workspaceId: 'mock-workspace', name: 'Default Workspace' }],
              },
            ],
          },
        ],
        selected: null,
      },
    })
    mockedFetchAccounts.mockResolvedValue({
      result: {
        businessId: 'bid',
        provider: 'gtm',
        accounts: [{ accountId: 'mock-account', name: 'Mock Account' }],
        selectedAccountId: null,
        selectedAccount: null,
      },
    })
  })

  it('loads options and saves selection', async () => {
    const onSaved = vi.fn()
    mockedSave.mockResolvedValueOnce({
      result: {
        businessId: 'bid',
        provider: 'gtm',
        selectionRequired: false,
        reason: null,
        accounts: [],
        selected: {
          accountId: 'mock-account',
          accountName: 'Mock Account',
          containerId: 'mock-container',
          containerName: 'Web',
          publicContainerId: 'GTM-MOCK',
          workspaceId: 'mock-workspace',
          workspaceName: 'Default Workspace',
          selectedAt: new Date().toISOString(),
        },
      },
    })

    const user = userEvent.setup()
    render(<GtmResourceSelector businessId="bid" onSaved={onSaved} />)

    await screen.findByLabelText(/gtm account/i)
    await user.click(screen.getByRole('button', { name: /save gtm selection/i }))

    await waitFor(() => {
      expect(mockedSave).toHaveBeenCalledWith({
        businessId: 'bid',
        accountId: 'mock-account',
        containerId: 'mock-container',
        workspaceId: 'mock-workspace',
      })
    })
    expect(onSaved).toHaveBeenCalled()
  })

  it('create-new mode loads accounts only and saves account selection', async () => {
    const onSaved = vi.fn()
    mockedSaveAccount.mockResolvedValueOnce({
      result: {
        businessId: 'bid',
        provider: 'gtm',
        connectionHealth: 'provisioning_required',
        providerIdentifiers: { accountId: 'mock-account' },
      },
    })

    const user = userEvent.setup()
    render(<GtmResourceSelector businessId="bid" mode="create-new" onSaved={onSaved} />)

    await screen.findByLabelText(/gtm account/i)
    await user.selectOptions(screen.getByLabelText(/gtm account/i), 'mock-account')
    await user.click(screen.getByRole('button', { name: /save gtm account/i }))

    await waitFor(() => {
      expect(mockedFetchAccounts).toHaveBeenCalledWith('bid')
      expect(mockedSaveAccount).toHaveBeenCalledWith({
        businessId: 'bid',
        accountId: 'mock-account',
      })
    })
    expect(mockedFetch).not.toHaveBeenCalled()
    expect(onSaved).toHaveBeenCalled()
  })
})
