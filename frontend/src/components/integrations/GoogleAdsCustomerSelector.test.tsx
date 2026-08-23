import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fetchGoogleAdsResourceOptions,
  saveGoogleAdsProvisioningIntent,
  saveGoogleAdsSelection,
} from '../../api/integrations'
import { GoogleAdsCustomerSelector } from './GoogleAdsCustomerSelector'

vi.mock('../../api/integrations', () => ({
  fetchGoogleAdsResourceOptions: vi.fn(),
  saveGoogleAdsSelection: vi.fn(),
  saveGoogleAdsProvisioningIntent: vi.fn(),
}))

const mockedFetch = vi.mocked(fetchGoogleAdsResourceOptions)
const mockedSave = vi.mocked(saveGoogleAdsSelection)
const mockedSaveIntent = vi.mocked(saveGoogleAdsProvisioningIntent)

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
    await user.click(screen.getByRole('button', { name: /review selection/i }))
    const confirmPanel = screen.getByRole('region', { name: /google ads selection confirmation/i })
    expect(confirmPanel).toHaveTextContent('Client')
    expect(confirmPanel).toHaveTextContent('123-456-7890')
    expect(confirmPanel).toHaveTextContent('enabled')
    await user.click(screen.getByRole('button', { name: /confirm and save/i }))

    await waitFor(() => {
      expect(mockedSave).toHaveBeenCalledWith({
        businessId: 'bid',
        customerId: '1234567890',
      })
    })
    expect(onSaved).toHaveBeenCalled()
  })

  it('records mcc_create provisioning intent and refreshes', async () => {
    const onSaved = vi.fn()
    mockedSaveIntent.mockResolvedValueOnce({
      result: {
        businessId: 'bid',
        provider: 'google_ads',
        provisioningIntent: 'mcc_create',
      },
    })

    const user = userEvent.setup()
    render(<GoogleAdsCustomerSelector businessId="bid" onSaved={onSaved} />)

    await screen.findByRole('button', { name: /create new google ads account under mcc/i })
    await user.click(
      screen.getByRole('button', { name: /create new google ads account under mcc/i }),
    )

    await waitFor(() => {
      expect(mockedSaveIntent).toHaveBeenCalledWith('bid')
    })
    expect(onSaved).toHaveBeenCalled()
  })
})
