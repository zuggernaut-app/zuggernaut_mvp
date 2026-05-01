import type { ReactElement } from 'react'

export function ErrorAlert({
  message,
}: {
  message: string | null | undefined
}): ReactElement | null {
  if (!message) return null
  return (
    <div className="alert alert-error" role="alert">
      {message}
    </div>
  )
}
