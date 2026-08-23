import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiError } from '../api/client'
import { PasswordResetPage } from './PasswordResetPage'

const hoisted = vi.hoisted(() => ({
  mockPasswordResetConfirm: vi.fn(),
}))

vi.mock('../api/auth', () => ({
  authPasswordResetConfirm: hoisted.mockPasswordResetConfirm,
}))

function renderPage(
  initialEntry = '/password-reset?token=abc123&email=reset%40example.com',
): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/password-reset" element={<PasswordResetPage />} />
        <Route path="/login" element={<div data-testid="login-target">login</div>} />
        <Route
          path="/password-reset/request"
          element={<div data-testid="request-target">request</div>}
        />
      </Routes>
    </MemoryRouter>,
  )
}

describe('PasswordResetPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockPasswordResetConfirm.mockResolvedValue({
      ok: true,
      message: 'Password updated. You can log in with your new password.',
    })
  })

  it('shows incomplete link state when query params missing', () => {
    renderPage('/password-reset')

    expect(screen.getByRole('alert')).toHaveTextContent(/incomplete or expired/i)
    expect(screen.getByRole('link', { name: /request reset link/i })).toBeInTheDocument()
  })

  it('submits new password and navigates to login', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText(/^new password$/i), 'NewSecurePass99')
    await user.type(screen.getByLabelText(/confirm new password/i), 'NewSecurePass99')
    await user.click(screen.getByRole('button', { name: /update password/i }))

    await waitFor(() => {
      expect(screen.getByTestId('login-target')).toBeInTheDocument()
    })

    expect(hoisted.mockPasswordResetConfirm).toHaveBeenCalledWith({
      email: 'reset@example.com',
      token: 'abc123',
      password: 'NewSecurePass99',
    })
  })

  it('shows ApiError message from API', async () => {
    hoisted.mockPasswordResetConfirm.mockRejectedValueOnce(
      new ApiError(400, 'Invalid or expired reset link.', 'validation_error'),
    )

    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText(/^new password$/i), 'NewSecurePass99')
    await user.type(screen.getByLabelText(/confirm new password/i), 'NewSecurePass99')
    await user.click(screen.getByRole('button', { name: /update password/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid or expired/i)
  })
})
