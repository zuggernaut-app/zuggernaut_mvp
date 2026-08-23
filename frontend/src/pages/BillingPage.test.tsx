import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiError } from '../api/client'
import { BillingPage } from './BillingPage'

const hoisted = vi.hoisted(() => ({
  mockBillingStatus: vi.fn(),
  mockBillingCheckout: vi.fn(),
  mockBillingPortal: vi.fn(),
}))

vi.mock('../api/billing', () => ({
  billingStatus: hoisted.mockBillingStatus,
  billingCheckout: hoisted.mockBillingCheckout,
  billingPortal: hoisted.mockBillingPortal,
}))

describe('BillingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockBillingStatus.mockResolvedValue({ subscription: null })
    hoisted.mockBillingCheckout.mockResolvedValue({
      checkoutUrl: 'https://checkout.example/success',
      sessionId: 'cs_test',
    })
    hoisted.mockBillingPortal.mockResolvedValue({ portalUrl: 'https://billing.example/portal' })
    vi.stubGlobal('location', { assign: vi.fn() })
  })

  it('shows subscribe when no subscription', async () => {
    render(
      <MemoryRouter>
        <BillingPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('button', { name: /subscribe/i })).toBeInTheDocument()
  })

  it('starts checkout on subscribe click', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <BillingPage />
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole('button', { name: /subscribe/i }))

    await waitFor(() => {
      expect(hoisted.mockBillingCheckout).toHaveBeenCalledWith('starter')
    })
    expect(window.location.assign).toHaveBeenCalledWith('https://checkout.example/success')
  })

  it('shows manage billing when subscription exists', async () => {
    hoisted.mockBillingStatus.mockResolvedValueOnce({
      subscription: {
        status: 'active',
        cancelAtPeriodEnd: false,
        plan: { tier: 'starter', name: 'Starter' },
      },
    })

    render(
      <MemoryRouter>
        <BillingPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('button', { name: /manage billing/i })).toBeInTheDocument()
  })

  it('shows ApiError on status failure', async () => {
    hoisted.mockBillingStatus.mockRejectedValueOnce(new ApiError(500, 'Billing down', 'internal_error'))

    render(
      <MemoryRouter>
        <BillingPage />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('alert')).toHaveTextContent('Billing down')
  })
})
