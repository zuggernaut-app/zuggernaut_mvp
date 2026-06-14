import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchGoogleAdsResourceOptions, saveGoogleAdsSelection } from '../../api/integrations'
import { GoogleAdsCustomerSelector } from './GoogleAdsCustomerSelector'

vi.mock('../../api/integrations', () => ({
  fetchGoogleAdsResourceOptions: vi.fn(),
  saveGoogleAdsSelection: vi.fn(),
}))

const mockedFetch = vi.mocked(fetchGoogleAdsResourceOptions)
const mockedSave = vi.mocked(saveGoogleAdsSelection)

describe('GoogleAdsCustomerSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedFetch.mockResolvedValue({
      result: {
        businessId: 'bid',
        provider: 'google_ads',
        selectionRequired: true,
        reason: 'ADS_CUSTOMER_SELECTION_REQUIRED',
        options: [
          {
            customerId: '1234567890',
            formattedCustomerId: '123-456-7890',
            descriptiveName: 'Client',
            kind: 'client',
            status: 'enabled',
            selectable: true,
            nonSelectableReason: null,
          },
          {
            customerId: '9876543210',
            formattedCustomerId: '987-654-3210',
            descriptiveName: 'Manager',
            kind: 'manager',
            status: 'enabled',
            selectable: false,
            nonSelectableReason: 'Manager accounts cannot be used for campaign setup.',
          },
        ],
        suggestedCustomerId: '1234567890',
        selected: null,
        accessibleCustomerIds: ['1234567890', '9876543210'],
        loginCustomerId: '3462198684',
      },
    })
  })

  it('loads customers and saves selection', async () => {
    const onSaved = vi.fn()
    mockedSave.mockResolvedValueOnce({
      result: {
        businessId: 'bid',
        provider: 'google_ads',
        selectionRequired: false,
        reason: null,
        options: [],
        suggestedCustomerId: null,
        selected: {
          customerId: '1234567890',
          formattedCustomerId: '123-456-7890',
          descriptiveName: 'Client',
          kind: 'client',
          status: 'enabled',
          selectedAt: new Date().toISOString(),
        },
        accessibleCustomerIds: ['1234567890'],
        loginCustomerId: '3462198684',
      },
    })

    const user = userEvent.setup()
    render(<GoogleAdsCustomerSelector businessId="bid" onSaved={onSaved} />)

    await screen.findByLabelText(/google ads customer/i)
    await user.click(screen.getByRole('button', { name: /save google ads selection/i }))

    await waitFor(() => {
      expect(mockedSave).toHaveBeenCalledWith({
        businessId: 'bid',
        customerId: '1234567890',
      })
    })
    expect(onSaved).toHaveBeenCalled()
  })
})
