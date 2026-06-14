import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchGtmResourceOptions, saveGtmSelection } from '../../api/integrations'
import { GtmResourceSelector } from './GtmResourceSelector'

vi.mock('../../api/integrations', () => ({
  fetchGtmResourceOptions: vi.fn(),
  saveGtmSelection: vi.fn(),
}))

const mockedFetch = vi.mocked(fetchGtmResourceOptions)
const mockedSave = vi.mocked(saveGtmSelection)

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
})
