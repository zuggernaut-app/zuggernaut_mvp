import type { ReactElement } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import { useAuth } from '../hooks/useAuth'

type RequireAuthProps = {
  children: ReactElement
}

export function RequireAuth({ children }: RequireAuthProps): ReactElement {
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

  return children
}
