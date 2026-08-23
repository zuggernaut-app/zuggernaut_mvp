import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiError } from '../api/client'
import { RequestPasswordResetPage } from './RequestPasswordResetPage'

const hoisted = vi.hoisted(() => ({
  mockPasswordResetRequest: vi.fn(),
}))

vi.mock('../api/auth', () => ({
  authPasswordResetRequest: hoisted.mockPasswordResetRequest,
}))

function renderPage(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/password-reset/request']}>
      <Routes>
        <Route path="/password-reset/request" element={<RequestPasswordResetPage />} />
        <Route path="/login" element={<div data-testid="login-target">login</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('RequestPasswordResetPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockPasswordResetRequest.mockResolvedValue({
      ok: true,
      message: 'If an account exists for that email, a reset link has been sent.',
    })
  })

  it('submits email and shows success message', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText(/^email$/i), 'user@example.com')
    await user.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/reset link has been sent/i)
    })

    expect(hoisted.mockPasswordResetRequest).toHaveBeenCalledWith({
      email: 'user@example.com',
    })
  })

  it('shows ApiError message from API', async () => {
    hoisted.mockPasswordResetRequest.mockRejectedValueOnce(
      new ApiError(429, 'Too many attempts', 'rate_limit_exceeded'),
    )

    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText(/^email$/i), 'user@example.com')
    await user.click(screen.getByRole('button', { name: /send reset link/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts')
  })
})
