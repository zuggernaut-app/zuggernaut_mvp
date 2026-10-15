import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { RequirePlatformAdmin } from '../../app/RequirePlatformAdmin'
import { AuthProvider } from '../../hooks/useAuth'
import { OnboardingProvider } from '../../hooks/useOnboardingState'
import { AdminConsolePage } from './AdminConsolePage'

const hoisted = vi.hoisted(() => ({
  mockAdminListBusinesses: vi.fn(),
  mockAuthMe: vi.fn(),
  mockListBusinessContexts: vi.fn(),
}))

vi.mock('../../api/businessContexts', () => ({
  listBusinessContexts: hoisted.mockListBusinessContexts,
}))

vi.mock('../../api/admin', () => ({
  adminListBusinesses: hoisted.mockAdminListBusinesses,
}))

vi.mock('../../api/auth', () => ({
  authMe: hoisted.mockAuthMe,
  authRegister: vi.fn(),
  authLogin: vi.fn(),
  authLogout: vi.fn().mockResolvedValue({ ok: true }),
}))

function renderAdminConsole(initialEntry = '/admin', platformAdmin = true) {
  hoisted.mockAuthMe.mockResolvedValue({
    user: {
      id: 'admin-1',
      email: 'admin@example.com',
      name: 'Admin',
      platformAdmin,
    },
  })

  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/" element={<div>Home page</div>} />
        <Route
          path="/admin"
          element={
            <AuthProvider>
              <OnboardingProvider>
                <RequirePlatformAdmin>
                  <AdminConsolePage />
                </RequirePlatformAdmin>
              </OnboardingProvider>
            </AuthProvider>
          }
        />
        <Route
          path="/admin/businesses/:businessId/operator"
          element={<div>Operator page</div>}
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('AdminConsolePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    hoisted.mockListBusinessContexts.mockResolvedValue({ businessContexts: [] })
    hoisted.mockAdminListBusinesses.mockResolvedValue({
      businesses: [
        {
          businessId: 'biz-1',
          businessName: 'Biz One',
          userId: 'user-1',
          customerEmail: 'user@example.com',
          orgId: null,
          confirmedAt: null,
          updatedAt: '2026-01-01T00:00:00.000Z',
          operatorListStatus: 'signup_complete',
        },
      ],
    })
  })

  it('shows admin console for platform admin', async () => {
    renderAdminConsole('/admin', true)

    expect(await screen.findByRole('heading', { name: /admin console/i })).toBeInTheDocument()
    expect(await screen.findByText(/Biz One/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /^open$/i })).toHaveAttribute(
      'href',
      '/admin/businesses/biz-1/operator',
    )
  })

  it('redirects non-admin users to home', async () => {
    renderAdminConsole('/admin', false)

    expect(await screen.findByText('Home page')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /admin console/i })).not.toBeInTheDocument()
  })
})
