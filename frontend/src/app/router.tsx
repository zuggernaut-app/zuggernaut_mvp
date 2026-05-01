import type { ReactElement } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { HomePage } from '../pages/HomePage'
import { RegisterPage } from '../pages/RegisterPage'
import { BusinessStartPage } from '../pages/BusinessStartPage'
import { WebsiteUrlPage } from '../pages/WebsiteUrlPage'
import { BusinessReviewPage } from '../pages/BusinessReviewPage'
import { StartSetupPage } from '../pages/StartSetupPage'
import { SetupProgressPage } from '../pages/SetupProgressPage'

export function AppRoutes(): ReactElement {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/onboarding/business" element={<BusinessStartPage />} />
      <Route path="/onboarding/suggestions" element={<WebsiteUrlPage />} />
      <Route path="/onboarding/review" element={<BusinessReviewPage />} />
      <Route path="/setup" element={<StartSetupPage />} />
      <Route path="/setup/progress/:setupRunId" element={<SetupProgressPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
