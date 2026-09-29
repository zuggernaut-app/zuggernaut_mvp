import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from '../../hooks/useAuth'
import { OnboardingProvider } from '../../hooks/useOnboardingState'
import { BusinessSwitcher } from './BusinessSwitcher'

function renderSwitcher() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <OnboardingProvider>
          <BusinessSwitcher />
        </OnboardingProvider>
      </AuthProvider>
    </MemoryRouter>,
  )
}

describe('BusinessSwitcher', () => {
  it('renders nothing during V1 soft launch', () => {
    renderSwitcher()
    expect(screen.queryByLabelText(/business/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})
