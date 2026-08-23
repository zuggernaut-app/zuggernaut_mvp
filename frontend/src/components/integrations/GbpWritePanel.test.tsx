import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { GbpWritePanel } from './GbpWritePanel'

const hoisted = vi.hoisted(() => ({
  mockWriteGbpLocation: vi.fn(),
}))

vi.mock('../../api/integrations', () => ({
  writeGbpLocation: hoisted.mockWriteGbpLocation,
}))

describe('GbpWritePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockWriteGbpLocation.mockResolvedValue({ result: { outcome: 'created' } })
  })

  it('requires consent before write', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <GbpWritePanel businessId="biz-1" />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: /publish gbp post/i }))
    expect(await screen.findByText(/explicit consent is required/i)).toBeInTheDocument()
    expect(hoisted.mockWriteGbpLocation).not.toHaveBeenCalled()
  })

  it('writes when consent checked', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <GbpWritePanel businessId="biz-1" />
      </MemoryRouter>,
    )

    await user.click(screen.getByLabelText(/consent to zuggernaut/i))
    await user.type(screen.getByLabelText(/post text/i), 'Hello GBP')
    await user.click(screen.getByRole('button', { name: /publish gbp post/i }))

    await waitFor(() => {
      expect(hoisted.mockWriteGbpLocation).toHaveBeenCalled()
    })
  })
})
