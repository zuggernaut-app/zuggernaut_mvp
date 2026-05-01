import type { ReactElement, ReactNode } from 'react'

export function InlineLoading({ label = 'Loading…' }: { label?: ReactNode }): ReactElement {
  return (
    <div className="spinnerWrap" role="status" aria-live="polite">
      <span className="spinner" aria-hidden />
      <span>{label}</span>
    </div>
  )
}
