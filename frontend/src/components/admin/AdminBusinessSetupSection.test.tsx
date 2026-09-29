import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { updateBusinessContext } from '../../api/businessContexts'
import { AdminBusinessSetupSection } from './AdminBusinessSetupSection'
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
  services: ['Offer line'],
  serviceAreas: ['Austin'],
  contactMethods: { emails: ['a@example.com'], phones: ['555-000-0000'] },
  audienceSignals: null,
  goals: { primary: 'forms' },
  differentiators: null,
  orderValueHint: null,
  thankYouUrls: [],
  uvp: null,
  competitorLandscape: null,
  businessScope: null,
  valueComplexity: null,
  budgetTier: null,
  susoVersion: 0,
  susoVersionUpdatedAt: null,
  confirmedAt: '2026-01-01T00:00:00.000Z',
}

describe('AdminBusinessSetupSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedUpdate.mockResolvedValue({
      businessContext: initial,
      adsReadiness: { ok: true },
      susoMatrix: null,
    })
  })

  it('PUTs only business setup fact keys', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(
      <AdminBusinessSetupSection businessId={TEST_IDS.business} initial={initial} onSaved={onSaved} />,
    )

    await user.click(screen.getByRole('button', { name: /save business setup/i }))

    await waitFor(() => {
      expect(mockedUpdate).toHaveBeenCalledWith(TEST_IDS.business, {
        businessName: 'Acme',
        websiteUrl: 'https://example.com',
        industry: 'Services',
        serviceAreas: ['Austin'],
        contactMethods: { emails: ['a@example.com'], phones: ['555-000-0000'] },
      })
    })
    expect(onSaved).toHaveBeenCalled()
  })
})
