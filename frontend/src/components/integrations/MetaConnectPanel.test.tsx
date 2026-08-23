import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { MetaConnectPanel } from './MetaConnectPanel'

const hoisted = vi.hoisted(() => ({
  mockGetMetaConnectUrl: vi.fn(),
  mockGetMetaStatus: vi.fn(),
  mockRunMetaSetup: vi.fn(),
}))

vi.mock('../../api/integrations', () => ({
  getMetaConnectUrl: hoisted.mockGetMetaConnectUrl,
  getMetaStatus: hoisted.mockGetMetaStatus,
  runMetaSetup: hoisted.mockRunMetaSetup,
}))

describe('MetaConnectPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockGetMetaConnectUrl.mockResolvedValue({ url: 'https://meta.example/oauth', source: 'mock' })
    hoisted.mockGetMetaStatus.mockResolvedValue({ status: { connected: false } })
    hoisted.mockRunMetaSetup.mockResolvedValue({ step: 'meta_setup_v1' })
  })

  it('loads status and shows setup button', async () => {
    render(
      <MemoryRouter>
        <MetaConnectPanel businessId="biz-1" />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('button', { name: /run meta setup/i })).toBeInTheDocument()
  })

  it('runs meta setup', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <MetaConnectPanel businessId="biz-1" />
      </MemoryRouter>,
    )

    await user.click(await screen.findByRole('button', { name: /run meta setup/i }))

    await waitFor(() => {
      expect(hoisted.mockRunMetaSetup).toHaveBeenCalledWith('biz-1')
    })
  })
})
