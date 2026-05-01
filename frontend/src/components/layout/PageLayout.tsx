import type { ReactElement, ReactNode } from 'react'
import layoutStyles from './PageLayout.module.css'

export interface PageLayoutProps {
  title: string
  lead?: string
  children: ReactNode
}

export function PageLayout({ title, lead, children }: PageLayoutProps): ReactElement {
  return (
    <div className={layoutStyles.shell}>
      <header className={layoutStyles.header}>
        <a className={layoutStyles.brand} href="/">
          Zuggernaut
        </a>
      </header>
      <main className={layoutStyles.main}>
        <h1>{title}</h1>
        {lead ? <p className="lead">{lead}</p> : null}
        {children}
      </main>
    </div>
  )
}
