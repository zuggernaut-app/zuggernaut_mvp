import type { ReactElement } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './RequireAuth'
import { HomePage } from '../pages/HomePage'
import { RegisterPage } from '../pages/RegisterPage'
import { LoginPage } from '../pages/LoginPage'
import { BusinessStartPage } from '../pages/BusinessStartPage'
import { WebsiteUrlPage } from '../pages/WebsiteUrlPage'
import { BusinessReviewPage } from '../pages/BusinessReviewPage'
import { StartSetupPage } from '../pages/StartSetupPage'
import { SetupProgressPage } from '../pages/SetupProgressPage'
import { SetupReportPage } from '../pages/SetupReportPage'
import { DevIntegrationsPage } from '../../../dev-tools/frontend/src/pages/dev/DevIntegrationsPage'
import { DevGoogleAdsOAuthLabPage } from '../../../dev-tools/frontend/src/pages/dev/DevGoogleAdsOAuthLabPage'
import { DevGtmOAuthLabPage } from '../../../dev-tools/frontend/src/pages/dev/DevGtmOAuthLabPage'
import { DevGbpOAuthLabPage } from '../../../dev-tools/frontend/src/pages/dev/DevGbpOAuthLabPage'
import { isDevIntegrationsEnabled } from '../../../dev-tools/frontend/src/api/dev/devIntegrations'

export function AppRoutes(): ReactElement {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/onboarding/business"
        element={
          <RequireAuth>
            <BusinessStartPage />
          </RequireAuth>
        }
      />
      <Route
        path="/onboarding/suggestions"
        element={
          <RequireAuth>
            <WebsiteUrlPage />
          </RequireAuth>
        }
      />
      <Route
        path="/onboarding/review"
        element={
          <RequireAuth>
            <BusinessReviewPage />
          </RequireAuth>
        }
      />
      <Route
        path="/setup"
        element={
          <RequireAuth>
            <StartSetupPage />
          </RequireAuth>
        }
      />
      <Route
        path="/setup/progress/:setupRunId"
        element={
          <RequireAuth>
            <SetupProgressPage />
          </RequireAuth>
        }
      />
      <Route
        path="/setup/report/:setupRunId"
        element={
          <RequireAuth>
            <SetupReportPage />
          </RequireAuth>
        }
      />
      {isDevIntegrationsEnabled() ? (
        <>
          <Route
            path="/dev/integrations"
            element={
              <RequireAuth>
                <DevIntegrationsPage />
              </RequireAuth>
            }
          />
          <Route
            path="/dev/integrations/googleads"
            element={
              <RequireAuth>
                <DevGoogleAdsOAuthLabPage />
              </RequireAuth>
            }
          />
          <Route
            path="/dev/integrations/gtm"
            element={
              <RequireAuth>
                <DevGtmOAuthLabPage />
              </RequireAuth>
            }
          />
          <Route
            path="/dev/integrations/gbp"
            element={
              <RequireAuth>
                <DevGbpOAuthLabPage />
              </RequireAuth>
            }
          />
        </>
      ) : null}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
