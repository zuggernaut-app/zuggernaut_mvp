import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getMccLinkStatus, sendMccLinkInvite } from '../../api/integrations'
import { MccLinkPanel } from './MccLinkPanel'

vi.mock('../../api/integrations', () => ({
  getMccLinkStatus: vi.fn(),
  sendMccLinkInvite: vi.fn(),
}))

const mockedGetStatus = vi.mocked(getMccLinkStatus)
const mockedSendInvite = vi.mocked(sendMccLinkInvite)

describe('MccLinkPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGetStatus.mockResolvedValue({
      businessId: '507f1f77bcf86cd799439011',
      mccLink: { status: 'REQUIRED', clientCustomerId: '1234567890' },
      manualAccept: {
        summary: 'Accept in Google Ads',
        steps: ['Step one'],
        googleAdsUrl: 'https://ads.google.com/aw/accountaccess/managers',
      },
      refreshed: true,
    })
  })

  it('shows link required state and send invite action', async () => {
    render(
      <MccLinkPanel
        businessId="507f1f77bcf86cd799439011"
        customerId="1234567890"
        onUpdated={vi.fn()}
      />,
    )

    expect(await screen.findByText(/Link Google Ads to Zuggernaut MCC/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Send invite/i })).toBeInTheDocument()
  })

  it('calls verify refresh endpoint when user clicks Verify link', async () => {
    const user = userEvent.setup()
    mockedGetStatus
      .mockResolvedValueOnce({
        businessId: '507f1f77bcf86cd799439011',
        mccLink: { status: 'PENDING', clientCustomerId: '1234567890' },
        manualAccept: {
          summary: 'Accept in Google Ads',
          steps: ['Step one'],
          googleAdsUrl: 'https://ads.google.com/aw/accountaccess/managers',
        },
        refreshed: true,
      })
      .mockResolvedValueOnce({
        businessId: '507f1f77bcf86cd799439011',
        mccLink: { status: 'ACTIVE', clientCustomerId: '1234567890' },
        manualAccept: {
          summary: 'Accept in Google Ads',
          steps: ['Step one'],
          googleAdsUrl: 'https://ads.google.com/aw/accountaccess/managers',
        },
        refreshed: true,
      })

    render(
      <MccLinkPanel
        businessId="507f1f77bcf86cd799439011"
        customerId="1234567890"
        onUpdated={vi.fn()}
      />,
    )

    await screen.findByText(/Invitation pending/i)
    await user.click(screen.getByRole('button', { name: /Verify link/i }))

    await waitFor(() => {
      expect(mockedGetStatus).toHaveBeenLastCalledWith('507f1f77bcf86cd799439011', {
        refresh: true,
      })
    })
  })

  it('sends invite via API', async () => {
    const user = userEvent.setup()
    mockedSendInvite.mockResolvedValue({
      businessId: '507f1f77bcf86cd799439011',
      outcome: 'pending',
      mccLink: { status: 'PENDING', clientCustomerId: '1234567890' },
      manualAccept: {
        summary: 'Accept in Google Ads',
        steps: ['Step one'],
        googleAdsUrl: 'https://ads.google.com/aw/accountaccess/managers',
      },
    })

    render(
      <MccLinkPanel
        businessId="507f1f77bcf86cd799439011"
        customerId="1234567890"
        onUpdated={vi.fn()}
      />,
    )

    await screen.findByRole('button', { name: /Send invite/i })
    await user.click(screen.getByRole('button', { name: /Send invite/i }))

    await waitFor(() => {
      expect(mockedSendInvite).toHaveBeenCalledWith('507f1f77bcf86cd799439011')
    })
  })
})
