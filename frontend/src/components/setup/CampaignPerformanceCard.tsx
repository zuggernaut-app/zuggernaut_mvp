import { useEffect, useState, type ReactElement } from 'react'
import { getAdsCampaignPerformance, type CampaignPerformanceMetrics } from '../../api/adsPerformance'
import { ApiError } from '../../api/client'
import { ErrorAlert } from '../feedback/ErrorAlert'
import { InlineLoading } from '../feedback/InlineLoading'

const MICROS_PER_UNIT = 1_000_000

function formatCost(micros: number): string {
  return (micros / MICROS_PER_UNIT).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  })
}

interface CampaignPerformanceCardProps {
  businessId: string
}

export function CampaignPerformanceCard({ businessId }: CampaignPerformanceCardProps): ReactElement {
  const [metrics, setMetrics] = useState<CampaignPerformanceMetrics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const { performance } = await getAdsCampaignPerformance(businessId)
        if (!cancelled) setMetrics(performance.metrics)
      } catch (err) {
        if (!cancelled) {
          if (err instanceof ApiError) setError(err.message)
          else setError('Could not load campaign performance.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [businessId])

  if (loading) return <InlineLoading label="Loading performance…" />
  if (error) return <ErrorAlert message={error} />
  if (!metrics) return <p className="notice">No performance data yet.</p>

  return (
    <section className="card" aria-label="Campaign performance">
      <h2>Campaign performance (last {metrics.dateRangeDays} days)</h2>
      <ul className="metric-list">
        <li>Impressions: <strong>{metrics.impressions.toLocaleString()}</strong></li>
        <li>Clicks: <strong>{metrics.clicks.toLocaleString()}</strong></li>
        <li>Cost: <strong>{formatCost(metrics.costMicros)}</strong></li>
        <li>Conversions: <strong>{metrics.conversions.toLocaleString()}</strong></li>
      </ul>
    </section>
  )
}
