import { useEffect, useState, type ReactElement } from 'react'
import { Link } from 'react-router-dom'
import { listBusinessContexts } from '../../api/businessContexts'
import { setPrimaryBusiness } from '../../api/users'
import { ApiError } from '../../api/client'
import { useOnboardingState } from '../../hooks/useOnboardingState'
import { useSoftLaunchMode } from '../../hooks/useSoftLaunchMode'
import { InlineLoading } from '../feedback/InlineLoading'

export function BusinessSwitcher(): ReactElement | null {
  const { snapshot, setBusinessId } = useOnboardingState()
  const { softLaunchMode, loading: softLaunchLoading } = useSoftLaunchMode()
  const [options, setOptions] = useState<Array<{ businessId: string; label: string }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const res = await listBusinessContexts()
        if (cancelled) return
        setOptions(
          res.businessContexts.map((bc) => ({
            businessId: bc.businessId,
            label: bc.businessName?.trim() || bc.businessId,
          })),
        )
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError) setError(err.message)
          else setError('Could not load businesses.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (softLaunchLoading || loading) return <InlineLoading label="Loading businesses…" />
  if (softLaunchMode) return null
  if (error) return <span className="notice">{error}</span>
  if (options.length <= 1) return null

  const current = snapshot.businessId ?? options[0]?.businessId ?? ''

  return (
    <div className="business-switcher" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
      <label htmlFor="business-switcher">Business</label>
      <select
        id="business-switcher"
        value={current}
        onChange={(e) => {
          const next = e.target.value
          setBusinessId(next)
          void setPrimaryBusiness(next).catch(() => undefined)
        }}
      >
        {options.map((opt) => (
          <option key={opt.businessId} value={opt.businessId}>
            {opt.label}
          </option>
        ))}
      </select>
      <Link className="btn btn-secondary" to="/onboarding/business">
        Add business
      </Link>
    </div>
  )
}
