import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiError } from '../../api/client'
import { CampaignPerformanceCard } from './CampaignPerformanceCard'

const hoisted = vi.hoisted(() => ({
  mockGetPerformance: vi.fn(),
}))

vi.mock('../../api/adsPerformance', () => ({
  getAdsCampaignPerformance: hoisted.mockGetPerformance,
}))

describe('CampaignPerformanceCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockGetPerformance.mockResolvedValue({
      performance: {
        businessId: 'biz1',
        campaignResourceName: 'customers/1/campaigns/2',
        metrics: {
          impressions: 500,
          clicks: 40,
          costMicros: 12_000_000,
          conversions: 3,
          dateRangeDays: 30,
        },
        source: 'google_ads_api_mock',
      },
    })
  })

  it('renders performance metrics', async () => {
    render(<CampaignPerformanceCard businessId="biz1" />)
    await waitFor(() => {
      expect(screen.getByText(/500/)).toBeInTheDocument()
    })
    expect(screen.getByText(/40/)).toBeInTheDocument()
    expect(screen.getByText(/3/)).toBeInTheDocument()
  })

  it('shows error on ApiError', async () => {
    hoisted.mockGetPerformance.mockRejectedValueOnce(new ApiError(404, 'Not found', 'not_found'))
    render(<CampaignPerformanceCard businessId="biz1" />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Not found')
  })
})
