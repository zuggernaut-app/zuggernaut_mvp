import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getAdsCampaign, enableAdsCampaign } from '../../api/adsManagement'
import { TEST_IDS } from '../../test/pageTestUtils'
import { EnableCampaignCard } from './EnableCampaignCard'

vi.mock('../../api/adsManagement', () => ({
  getAdsCampaign: vi.fn(),
  enableAdsCampaign: vi.fn(),
  pauseAdsCampaign: vi.fn(),
  updateAdsCampaignBudget: vi.fn(),
}))

const mockedGet = vi.mocked(getAdsCampaign)
const mockedEnable = vi.mocked(enableAdsCampaign)

const pausedCampaign = {
  campaignResourceName: 'customers/1234567890/campaigns/99',
  status: 'PAUSED',
  budgetResourceName: 'customers/1234567890/campaignBudgets/42',
  amountMicros: 10_000_000,
  setupRunId: TEST_IDS.setupRun,
  source: 'google_ads_api_mock',
}

const enabledCampaign = {
  ...pausedCampaign,
  status: 'ENABLED',
}

describe('EnableCampaignCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedGet.mockResolvedValue({ campaign: pausedCampaign })
    mockedEnable.mockResolvedValue({ outcome: 'enabled' })
  })

  it('shows enable confirmation modal and calls enable API on confirm', async () => {
    mockedGet
      .mockResolvedValueOnce({ campaign: pausedCampaign })
      .mockResolvedValueOnce({ campaign: enabledCampaign })

    const user = userEvent.setup()
    render(<EnableCampaignCard businessId={TEST_IDS.business} />)

    const enableButton = await screen.findByRole('button', { name: /enable campaign/i })
    await user.click(enableButton)

    expect(
      await screen.findByRole('heading', { name: /enable this google ads campaign/i }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /yes, enable campaign/i }))

    await waitFor(() => {
      expect(mockedEnable).toHaveBeenCalledWith(TEST_IDS.business)
    })
    expect(mockedGet).toHaveBeenCalledTimes(2)
  })
})
