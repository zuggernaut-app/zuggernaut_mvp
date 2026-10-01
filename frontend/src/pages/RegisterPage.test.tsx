import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ApiError } from '../api/client'
import { AuthProvider } from '../hooks/useAuth'
import { OnboardingProvider } from '../hooks/useOnboardingState'
import { RegisterPage } from './RegisterPage'
import { TEST_IDS, seedSession } from '../test/pageTestUtils'

const hoisted = vi.hoisted(() => ({
  mockAuthMe: vi.fn(),
  mockAuthRegister: vi.fn(),
  mockAuthLogin: vi.fn(),
  mockAuthLogout: vi.fn(),
}))

vi.mock('../api/auth', () => ({
  authMe: hoisted.mockAuthMe,
  authRegister: hoisted.mockAuthRegister,
  authLogin: hoisted.mockAuthLogin,
  authLogout: hoisted.mockAuthLogout,
}))

vi.mock('../api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/client')>()
  return {
    ...actual,
    ensureCsrfCookie: vi.fn().mockResolvedValue(undefined),
  }
})

function renderRegister(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <AuthProvider>
        <OnboardingProvider>
          <Routes>
            <Route path="/register" element={<RegisterPage />} />
            <Route
              path="/onboarding/accounts"
              element={<div data-testid="accounts-target">accounts ok</div>}
            />
          </Routes>
        </OnboardingProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedSession({})
    hoisted.mockAuthMe.mockRejectedValue(new ApiError(401, 'Unauthorized', 'unauthorized'))
    hoisted.mockAuthLogout.mockResolvedValue({ ok: true })
    hoisted.mockAuthRegister.mockResolvedValue({
      user: {
        id: TEST_IDS.user,
        email: 'new@example.com',
        name: null,
        primaryBusinessId: TEST_IDS.business,
      },
    })
  })

  it('shows validation error for invalid email', async () => {
    const user = userEvent.setup()
    renderRegister()

    await user.type(screen.getByLabelText(/^email$/i), 'not-an-email')
    await user.type(screen.getByLabelText(/^phone$/i), '555-123-4567')
    await user.type(screen.getByLabelText(/^password$/i), 'SecurePass12')
    await user.type(screen.getByLabelText(/confirm password/i), 'SecurePass12')

    const form = screen.getByRole('button', { name: /continue/i }).closest('form')
    expect(form).toBeTruthy()
    fireEvent.submit(form as HTMLFormElement)

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid/i)
    expect(hoisted.mockAuthRegister).not.toHaveBeenCalled()
  })

  it('shows ApiError message from API', async () => {
    hoisted.mockAuthRegister.mockRejectedValueOnce(new ApiError(409, 'Email taken', 'conflict'))

    const user = userEvent.setup()
    renderRegister()

    await user.type(screen.getByLabelText(/^email$/i), 'taken@example.com')
    await user.type(screen.getByLabelText(/^phone$/i), '555-123-4567')
    await user.type(screen.getByLabelText(/^password$/i), 'SecurePass12')
    await user.type(screen.getByLabelText(/confirm password/i), 'SecurePass12')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Email taken')
  })

  it('persists user id and navigates after successful registration', async () => {
    const user = userEvent.setup()
    renderRegister()

    await user.type(screen.getByLabelText(/^email$/i), 'new@example.com')
    await user.type(screen.getByLabelText(/^phone$/i), '555-123-4567')
    await user.type(screen.getByLabelText(/^password$/i), 'SecurePass12')
    await user.type(screen.getByLabelText(/confirm password/i), 'SecurePass12')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => {
      expect(screen.getByTestId('accounts-target')).toBeInTheDocument()
    })

    expect(localStorage.getItem('zuggernaut:userId')).toBe(TEST_IDS.user)
    expect(hoisted.mockAuthRegister).toHaveBeenCalledWith({
      email: 'new@example.com',
      password: 'SecurePass12',
      phone: '555-123-4567',
    })
  })

  it('sends optional name and website when provided', async () => {
    const user = userEvent.setup()
    renderRegister()

    await user.type(screen.getByLabelText(/^email$/i), 'u@example.com')
    await user.type(screen.getByLabelText(/^phone$/i), '555-123-4567')
    await user.type(screen.getByLabelText(/^password$/i), 'SecurePass12')
    await user.type(screen.getByLabelText(/confirm password/i), 'SecurePass12')
    await user.type(screen.getByLabelText(/name \(optional\)/i), 'Pat')
    await user.type(screen.getByLabelText(/website \(optional\)/i), 'https://pat.example')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => {
      expect(screen.getByTestId('accounts-target')).toBeInTheDocument()
    })

    expect(hoisted.mockAuthRegister).toHaveBeenCalledWith({
      email: 'u@example.com',
      password: 'SecurePass12',
      phone: '555-123-4567',
      name: 'Pat',
      websiteUrl: 'https://pat.example',
    })
  })

  it('rejects mismatched passwords', async () => {
    const user = userEvent.setup()
    renderRegister()

    await user.type(screen.getByLabelText(/^email$/i), 'pw@example.com')
    await user.type(screen.getByLabelText(/^phone$/i), '555-123-4567')
    await user.type(screen.getByLabelText(/^password$/i), 'SecurePass12')
    await user.type(screen.getByLabelText(/confirm password/i), 'OtherPass999')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/match/i)
    expect(hoisted.mockAuthRegister).not.toHaveBeenCalled()
  })
})
