import type { ReactElement } from 'react'
import { AppRoutes } from './router'

/**
 * Root shell for the SPA. Layout chrome lives in `PageLayout` per screen.
 */
export function AppShell(): ReactElement {
  return <AppRoutes />
}
