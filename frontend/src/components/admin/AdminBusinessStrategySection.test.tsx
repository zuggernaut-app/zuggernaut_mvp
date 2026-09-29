import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { updateBusinessContext } from '../../api/businessContexts'
import { AdminBusinessStrategySection } from './AdminBusinessStrategySection'
import { TEST_IDS } from '../../test/pageTestUtils'

vi.mock('../../api/businessContexts', () => ({
  updateBusinessContext: vi.fn(),
}))

const mockedUpdate = vi.mocked(updateBusinessContext)

const initial = {
  businessId: TEST_IDS.business,
  userId: TEST_IDS.user,
  websiteUrl: 'https://example.com',
  businessName: 'Acme',
  industry: 'Services',
  services: ['Residential plumbing'],
  serviceAreas: ['Austin'],
  contactMethods: null,
  audienceSignals: null,
  goals: { primary: 'forms' },
  differentiators: 'Licensed',
  orderValueHint: null,
  thankYouUrls: [],
  uvp: 'Fast plumbing',
  competitorLandscape: { competitors: [{ name: 'Rival' }] },
  businessScope: 'local_service' as const,
  valueComplexity: 'low_value_low_complexity' as const,
  budgetTier: 'starter' as const,
  susoVersion: 1,
  susoVersionUpdatedAt: null,
  confirmedAt: '2026-01-01T00:00:00.000Z',
}

describe('AdminBusinessStrategySection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedUpdate.mockResolvedValue({
      businessContext: initial,
      adsReadiness: { ok: true },
      susoMatrix: {
        ctaStyle: 'buy_now',
        gates: [],
        cells: [{ objective: 'leadgen', stage: 'conversion', segment: 'geographic', label: 'Cell', status: 'eligible' }],
      },
    })
  })

  it('PUTs only strategy keys and updates matrix preview', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(
      <AdminBusinessStrategySection
        businessId={TEST_IDS.business}
        initial={initial}
        matrix={null}
        onSaved={onSaved}
      />,
    )

    await user.click(screen.getByRole('button', { name: /save business strategy/i }))

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith(
        TEST_IDS.business,
        expect.objectContaining({
          services: ['Residential plumbing'],
          uvp: 'Fast plumbing',
          differentiators: 'Licensed',
          businessScope: 'local_service',
          valueComplexity: 'low_value_low_complexity',
          budgetTier: 'starter',
        }),
      )
    })
    expect(mockedUpdate.mock.calls[0][1]).not.toHaveProperty('serviceAreas')
    expect(onSaved).toHaveBeenCalledWith(
      initial,
      expect.objectContaining({ cells: expect.any(Array) }),
    )
  })
})
