import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AuthProvider } from '../../hooks/useAuth'
import { OnboardingProvider } from '../../hooks/useOnboardingState'
import { BusinessSwitcher } from './BusinessSwitcher'

const hoisted = vi.hoisted(() => ({
  mockListBusinessContexts: vi.fn(),
  mockSetPrimaryBusiness: vi.fn(),
  mockAuthMe: vi.fn(),
}))

vi.mock('../../api/businessContexts', () => ({
  listBusinessContexts: hoisted.mockListBusinessContexts,
}))

vi.mock('../../api/users', () => ({
  setPrimaryBusiness: hoisted.mockSetPrimaryBusiness,
}))

vi.mock('../../api/auth', () => ({
  authMe: hoisted.mockAuthMe,
  authRegister: vi.fn(),
  authLogin: vi.fn(),
  authLogout: vi.fn().mockResolvedValue({ ok: true }),
}))

function renderSwitcher() {
  hoisted.mockAuthMe.mockResolvedValue({
    user: { id: 'user-1', email: 'owner@example.com', name: 'Owner' },
  })
  return render(
    <MemoryRouter>
      <AuthProvider>
        <OnboardingProvider>
          <BusinessSwitcher />
        </OnboardingProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('BusinessSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockSetPrimaryBusiness.mockResolvedValue({ ok: true, primaryBusinessId: 'biz-2' })
    hoisted.mockListBusinessContexts.mockResolvedValue({
      businessContexts: [
        { businessId: 'biz-1', businessName: 'Alpha', userId: 'user-1' },
        { businessId: 'biz-2', businessName: 'Beta', userId: 'user-1' },
      ],
    })
  })

  it('renders switcher when multiple businesses exist', async () => {
    renderSwitcher()
    expect(await screen.findByLabelText(/business/i)).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Alpha' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Beta' })).toBeInTheDocument()
  })

  it('switches business and updates primary business', async () => {
    const user = userEvent.setup()
    renderSwitcher()
    const select = await screen.findByLabelText(/business/i)
    await user.selectOptions(select, 'biz-2')

    await waitFor(() => {
      expect(hoisted.mockSetPrimaryBusiness).toHaveBeenCalledWith('biz-2')
    })
  })
})
