import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { RequirePlatformAdmin } from '../../app/RequirePlatformAdmin'
import { AuthProvider } from '../../hooks/useAuth'
import { OnboardingProvider } from '../../hooks/useOnboardingState'
import { AdminConsolePage } from './AdminConsolePage'

const hoisted = vi.hoisted(() => ({
  mockAdminListUsers: vi.fn(),
  mockAdminListBusinesses: vi.fn(),
  mockAdminListSetupRuns: vi.fn(),
  mockAdminGetSetupRunReport: vi.fn(),
  mockAuthMe: vi.fn(),
  mockListBusinessContexts: vi.fn(),
}))

vi.mock('../../api/businessContexts', () => ({
  listBusinessContexts: hoisted.mockListBusinessContexts,
}))

vi.mock('../../api/admin', () => ({
  adminListUsers: hoisted.mockAdminListUsers,
  adminListBusinesses: hoisted.mockAdminListBusinesses,
  adminListSetupRuns: hoisted.mockAdminListSetupRuns,
  adminGetSetupRunReport: hoisted.mockAdminGetSetupRunReport,
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
      </Routes>
    </MemoryRouter>,
  )
}

describe('AdminConsolePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockListBusinessContexts.mockResolvedValue({ businessContexts: [] })
    hoisted.mockAdminListUsers.mockResolvedValue({
      users: [{ id: 'user-1', email: 'user@example.com', name: 'User', platformAdmin: false }],
    })
    hoisted.mockAdminListBusinesses.mockResolvedValue({
      businesses: [
        {
          businessId: 'biz-1',
          businessName: 'Biz One',
          userId: 'user-1',
          orgId: null,
          confirmedAt: null,
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    hoisted.mockAdminListSetupRuns.mockResolvedValue({
      setupRuns: [
        {
          setupRunId: 'run-1',
          businessId: 'biz-1',
          status: 'completed',
          temporalWorkflowId: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    })
    hoisted.mockAdminGetSetupRunReport.mockResolvedValue({
      report: { setupRun: { id: 'run-1' } },
    })
  })

  it('shows admin console for platform admin', async () => {
    renderAdminConsole('/admin', true)

    expect(await screen.findByRole('heading', { name: /admin console/i })).toBeInTheDocument()
    expect(await screen.findByText(/user@example.com/)).toBeInTheDocument()
    expect(screen.getByText(/Biz One/)).toBeInTheDocument()
  })

  it('redirects non-admin users to home', async () => {
    renderAdminConsole('/admin', false)

    expect(await screen.findByText('Home page')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /admin console/i })).not.toBeInTheDocument()
    await waitFor(() => {
      expect(hoisted.mockAdminListUsers).not.toHaveBeenCalled()
    })
  })
})
