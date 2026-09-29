import type { ReactElement } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { RequireAuth } from './RequireAuth'
import { RequirePlatformAdmin } from './RequirePlatformAdmin'
import { HomePage } from '../pages/HomePage'
import { RegisterPage } from '../pages/RegisterPage'
import { LoginPage } from '../pages/LoginPage'
import { RequestPasswordResetPage } from '../pages/RequestPasswordResetPage'
import { PasswordResetPage } from '../pages/PasswordResetPage'
import { BillingPage } from '../pages/BillingPage'
import { TeamPage } from '../pages/TeamPage'
import { AdminConsolePage } from '../pages/admin/AdminConsolePage'
import { AdminBusinessStrategyPage } from '../pages/admin/AdminBusinessStrategyPage'
import { AdminBusinessWorkspacePage } from '../pages/admin/AdminBusinessWorkspacePage'
import { BusinessStartPage } from '../pages/BusinessStartPage'
import { IntakeThankYouPage } from '../pages/IntakeThankYouPage'
import { WebsiteUrlPage } from '../pages/WebsiteUrlPage'
import { BusinessReviewPage } from '../pages/BusinessReviewPage'
import { BusinessContextEditPage } from '../pages/BusinessContextEditPage'
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
      <Route path="/password-reset/request" element={<RequestPasswordResetPage />} />
      <Route path="/password-reset" element={<PasswordResetPage />} />
      <Route
        path="/billing"
        element={
          <RequireAuth>
            <BillingPage />
          </RequireAuth>
        }
      />
      <Route
        path="/team/accept-invite"
        element={
          <RequireAuth>
            <TeamPage />
          </RequireAuth>
        }
      />
      <Route
        path="/team"
        element={
          <RequireAuth>
            <TeamPage />
          </RequireAuth>
        }
      />
      <Route
        path="/admin"
        element={
          <RequireAuth>
            <RequirePlatformAdmin>
              <AdminConsolePage />
            </RequirePlatformAdmin>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/businesses/:businessId"
        element={
          <RequireAuth>
            <RequirePlatformAdmin>
              <AdminBusinessWorkspacePage />
            </RequirePlatformAdmin>
          </RequireAuth>
        }
      />
      <Route
        path="/admin/businesses/:businessId/strategy"
        element={
          <RequireAuth>
            <RequirePlatformAdmin>
              <AdminBusinessStrategyPage />
            </RequirePlatformAdmin>
          </RequireAuth>
        }
      />
      <Route
        path="/onboarding/business"
        element={
          <RequireAuth>
            <BusinessStartPage />
          </RequireAuth>
        }
      />
      <Route
        path="/onboarding/thank-you"
        element={
          <RequireAuth>
            <IntakeThankYouPage />
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
        path="/onboarding/step-0"
        element={
          <RequireAuth>
            <Navigate to="/onboarding/business" replace />
          </RequireAuth>
        }
      />
      <Route
        path="/business-context/:businessId/edit"
        element={
          <RequireAuth>
            <BusinessContextEditPage />
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
