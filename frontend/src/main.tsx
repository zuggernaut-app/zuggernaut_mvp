import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { AppShell } from './app/AppShell'
import { OnboardingProvider } from './hooks/useOnboardingState'
import './styles/global.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <OnboardingProvider>
        <AppShell />
      </OnboardingProvider>
    </BrowserRouter>
  </StrictMode>
)
