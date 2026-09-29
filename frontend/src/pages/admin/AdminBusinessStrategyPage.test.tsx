import { render, screen } from '@testing-library/react'

import { MemoryRouter, Route, Routes } from 'react-router-dom'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getBusinessContext } from '../../api/businessContexts'

import { RequirePlatformAdmin } from '../../app/RequirePlatformAdmin'

import { AuthProvider } from '../../hooks/useAuth'

import { OnboardingProvider } from '../../hooks/useOnboardingState'

import { TEST_IDS } from '../../test/pageTestUtils'

import { AdminBusinessStrategyPage } from './AdminBusinessStrategyPage'



const hoisted = vi.hoisted(() => ({

  mockAuthMe: vi.fn(),

  mockListBusinessContexts: vi.fn(),

}))



vi.mock('../../api/businessContexts', () => ({

  getBusinessContext: vi.fn(),

  listBusinessContexts: hoisted.mockListBusinessContexts,

}))



vi.mock('../../api/auth', () => ({

  authMe: hoisted.mockAuthMe,

  authRegister: vi.fn(),

  authLogin: vi.fn(),

  authLogout: vi.fn().mockResolvedValue({ ok: true }),

}))



const mockedGet = vi.mocked(getBusinessContext)



function renderStrategyPage(businessId = TEST_IDS.business): ReturnType<typeof render> {

  hoisted.mockAuthMe.mockResolvedValue({

    user: {

      id: 'admin-1',

      email: 'admin@example.com',

      name: 'Admin',

      platformAdmin: true,

    },

  })

  hoisted.mockListBusinessContexts.mockResolvedValue({ businessContexts: [] })



  return render(

    <MemoryRouter initialEntries={[`/admin/businesses/${businessId}/strategy`]}>

      <Routes>

        <Route

          path="/admin/businesses/:businessId/strategy"

          element={

            <AuthProvider>

              <OnboardingProvider>

                <RequirePlatformAdmin>

                  <AdminBusinessStrategyPage />

                </RequirePlatformAdmin>

              </OnboardingProvider>

            </AuthProvider>

          }

        />

      </Routes>

    </MemoryRouter>,

  )

}



describe('AdminBusinessStrategyPage', () => {

  beforeEach(() => {

    vi.clearAllMocks()

    mockedGet.mockResolvedValue({

      businessContext: {

        businessId: TEST_IDS.business,

        userId: TEST_IDS.user,

        websiteUrl: 'https://example.com',

        businessName: 'Acme Plumbing',

        industry: 'Plumbing',

        services: ['Residential plumbing'],

        serviceAreas: ['Austin, TX'],

        contactMethods: { emails: ['ops@example.com'], phones: ['555-123-4567'] },

        audienceSignals: null,

        goals: { primary: 'forms' },

        differentiators: 'Licensed and insured',

        orderValueHint: null,

        thankYouUrls: [],

        uvp: 'Fast local plumbing',

        competitorLandscape: { competitors: [{ name: 'Rival Co' }] },

        businessScope: 'local_service',

        valueComplexity: 'low_value_low_complexity',

        budgetTier: 'starter',

        susoVersion: 1,

        susoVersionUpdatedAt: null,

        confirmedAt: '2026-01-01T00:00:00.000Z',

      },

      adsReadiness: { ok: true },

      susoMatrix: {

        ctaStyle: 'buy_now',

        gates: [],

        cells: [],

      },

    })

  })



  it('loads business context and renders strategy-only page with objectives preview', async () => {

    renderStrategyPage()



    expect(await screen.findByRole('heading', { name: /acme plumbing/i })).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: /business strategy/i })).toBeInTheDocument()

    expect(screen.queryByRole('heading', { name: /business setup/i })).not.toBeInTheDocument()

    expect(screen.queryByRole('heading', { name: /account setup/i })).not.toBeInTheDocument()

    expect(screen.getByRole('region', { name: /objectives preview/i })).toBeInTheDocument()

    expect(mockedGet).toHaveBeenCalledWith(TEST_IDS.business)

  })

})


