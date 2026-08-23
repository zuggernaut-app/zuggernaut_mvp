import type { ReactElement } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import { useAuth } from '../hooks/useAuth'

type RequirePlatformAdminProps = {
  children: ReactElement
}

export function RequirePlatformAdmin({ children }: RequirePlatformAdminProps): ReactElement {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <PageLayout title="Signing in…">
        <InlineLoading />
      </PageLayout>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />
  }

  if (!user.platformAdmin) {
    return <Navigate to="/" replace />
  }

  return children
}
