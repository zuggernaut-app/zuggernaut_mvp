import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { DevGbpOAuthLabPage } from './DevGbpOAuthLabPage'

vi.mock('../api/devIntegrations', () => ({
  isDevIntegrationsEnabled: vi.fn(),
}))

vi.mock('../api/gbpOAuthLab', () => ({
  createSandboxBusiness: vi.fn(),
  fetchGbpOAuthLabConnectUrl: vi.fn(),
  runGbpOAuthTrace: vi.fn(),
  runGbpReadTest: vi.fn(),
}))

import { isDevIntegrationsEnabled } from '../api/devIntegrations'
import * as labApi from '../api/gbpOAuthLab'

describe('DevGbpOAuthLabPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows disabled message when flag is off', () => {
    vi.mocked(isDevIntegrationsEnabled).mockReturnValue(false)
    render(
      <MemoryRouter>
        <DevGbpOAuthLabPage />
      </MemoryRouter>,
    )
    expect(screen.getByText(/disabled/i)).toBeInTheDocument()
  })

  it('renders GBP OAuth actions after bootstrap', async () => {
    vi.mocked(isDevIntegrationsEnabled).mockReturnValue(true)
    vi.mocked(labApi.createSandboxBusiness).mockResolvedValue({
      businessId: 'abc123',
      created: true,
      businessName: 'Sandbox',
      confirmedAt: new Date().toISOString(),
    })

    render(
      <MemoryRouter>
        <DevGbpOAuthLabPage />
      </MemoryRouter>,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Connect \(OAuth\)/i })).toBeInTheDocument()
      expect(screen.getByText(/read-only in V1/i)).toBeInTheDocument()
    })
  })
})
