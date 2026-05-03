import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createUser } from '../api/users'
import { ApiError } from '../api/client'
import { OnboardingProvider } from '../hooks/useOnboardingState'
import { RegisterPage } from './RegisterPage'
import { TEST_IDS, seedSession } from '../test/pageTestUtils'

vi.mock('../api/users', () => ({
  createUser: vi.fn(),
}))

const mockedCreateUser = vi.mocked(createUser)

function renderRegister(): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={['/register']}>
      <OnboardingProvider>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/onboarding/business"
            element={<div data-testid="business-target">business ok</div>}
          />
        </Routes>
      </OnboardingProvider>
    </MemoryRouter>,
  )
}

describe('RegisterPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    seedSession({})
  })

  it('shows validation error for invalid email', async () => {
    const user = userEvent.setup()
    renderRegister()

    await user.type(screen.getByLabelText(/email/i), 'not-an-email')
    const form = screen.getByRole('button', { name: /continue/i }).closest('form')
    expect(form).toBeTruthy()
    fireEvent.submit(form as HTMLFormElement)

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid/i)
    expect(mockedCreateUser).not.toHaveBeenCalled()
  })

  it('shows ApiError message from API', async () => {
    mockedCreateUser.mockRejectedValueOnce(new ApiError(409, 'Email taken', 'conflict'))

    const user = userEvent.setup()
    renderRegister()

    await user.type(screen.getByLabelText(/email/i), 'taken@example.com')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Email taken')
  })

  it('persists user id and navigates after successful registration', async () => {
    mockedCreateUser.mockResolvedValueOnce({
      user: {
        id: TEST_IDS.user,
        email: 'new@example.com',
        name: null,
      },
    })

    const user = userEvent.setup()
    renderRegister()

    await user.type(screen.getByLabelText(/email/i), 'new@example.com')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => {
      expect(screen.getByTestId('business-target')).toBeInTheDocument()
    })

    expect(localStorage.getItem('zuggernaut:userId')).toBe(TEST_IDS.user)
    expect(mockedCreateUser).toHaveBeenCalledWith('new@example.com', undefined)
  })

  it('sends optional name when provided', async () => {
    mockedCreateUser.mockResolvedValueOnce({
      user: {
        id: TEST_IDS.user,
        email: 'u@example.com',
        name: 'Pat',
      },
    })

    const user = userEvent.setup()
    renderRegister()

    await user.type(screen.getByLabelText(/email/i), 'u@example.com')
    await user.type(screen.getByLabelText(/name/i), 'Pat')
    await user.click(screen.getByRole('button', { name: /continue/i }))

    await waitFor(() => {
      expect(screen.getByTestId('business-target')).toBeInTheDocument()
    })

    expect(mockedCreateUser).toHaveBeenCalledWith('u@example.com', 'Pat')
  })
})
