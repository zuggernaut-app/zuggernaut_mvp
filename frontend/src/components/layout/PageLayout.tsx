import type { ReactElement, ReactNode } from 'react'
import layoutStyles from './PageLayout.module.css'
import { BusinessSwitcher } from '../nav/BusinessSwitcher'
import { useAuth } from '../../hooks/useAuth'

export interface PageLayoutProps {
  title: string
  lead?: string
  children: ReactNode
}

export function PageLayout({ title, lead, children }: PageLayoutProps): ReactElement {
  const { user } = useAuth()

  return (
    <div className={layoutStyles.shell}>
      <header className={layoutStyles.header}>
        <a className={layoutStyles.brand} href="/">
          Zuggernaut
        </a>
        {user ? <BusinessSwitcher /> : null}
      </header>
      <main className={layoutStyles.main}>
        <h1>{title}</h1>
        {lead ? <p className="lead">{lead}</p> : null}
        {children}
      </main>
    </div>
  )
}
