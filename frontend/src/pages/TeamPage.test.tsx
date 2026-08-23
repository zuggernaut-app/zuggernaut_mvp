import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { AuthProvider } from '../hooks/useAuth'
import { OnboardingProvider } from '../hooks/useOnboardingState'
import { TeamPage } from './TeamPage'

const hoisted = vi.hoisted(() => ({
  mockListOrgs: vi.fn(),
  mockCreateOrg: vi.fn(),
  mockSendOrgInvite: vi.fn(),
  mockAcceptOrgInvite: vi.fn(),
  mockAuthMe: vi.fn(),
  mockListBusinessContexts: vi.fn(),
}))

vi.mock('../api/businessContexts', () => ({
  listBusinessContexts: hoisted.mockListBusinessContexts,
}))

vi.mock('../api/orgs', () => ({
  listOrgs: hoisted.mockListOrgs,
  createOrg: hoisted.mockCreateOrg,
  sendOrgInvite: hoisted.mockSendOrgInvite,
  acceptOrgInvite: hoisted.mockAcceptOrgInvite,
}))

vi.mock('../api/auth', () => ({
  authMe: hoisted.mockAuthMe,
  authRegister: vi.fn(),
  authLogin: vi.fn(),
  authLogout: vi.fn().mockResolvedValue({ ok: true }),
}))

function renderTeamPage(initialEntry = '/team') {
  hoisted.mockAuthMe.mockResolvedValue({
    user: { id: 'user-1', email: 'owner@example.com', name: 'Owner' },
  })
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AuthProvider>
        <OnboardingProvider>
          <TeamPage />
        </OnboardingProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('TeamPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockListBusinessContexts.mockResolvedValue({ businessContexts: [] })
    hoisted.mockListOrgs.mockResolvedValue({
      orgs: [{ id: 'org-1', name: 'Acme Org', role: 'owner' }],
    })
    hoisted.mockCreateOrg.mockResolvedValue({ org: { id: 'org-new', name: 'New Org' } })
    hoisted.mockSendOrgInvite.mockResolvedValue({ ok: true, message: 'Invite sent' })
    hoisted.mockAcceptOrgInvite.mockResolvedValue({ ok: true, orgId: 'org-1' })
  })

  it('shows invite form for org owner', async () => {
    renderTeamPage()

    expect(await screen.findByLabelText(/invite email/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send invite/i })).toBeInTheDocument()
  })

  it('sends invite', async () => {
    const user = userEvent.setup()
    renderTeamPage()

    await user.type(await screen.findByLabelText(/invite email/i), 'member@example.com')
    await user.click(screen.getByRole('button', { name: /send invite/i }))

    await waitFor(() => {
      expect(hoisted.mockSendOrgInvite).toHaveBeenCalledWith('org-1', 'member@example.com', 'member')
    })
  })

  it('shows create org when user has no orgs', async () => {
    hoisted.mockListOrgs.mockResolvedValue({ orgs: [] })
    renderTeamPage()

    expect(await screen.findByRole('button', { name: /create organization/i })).toBeInTheDocument()
  })
})
