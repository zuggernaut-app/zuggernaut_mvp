import { useEffect, useState, type ReactElement } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { getBusinessContext } from '../../api/businessContexts'
import type { BusinessContextDto, SusoMatrixPreview } from '../../types/api'
import { AdminBusinessStrategySection } from '../../components/admin/AdminBusinessStrategySection'
import { ErrorAlert } from '../../components/feedback/ErrorAlert'
import { InlineLoading } from '../../components/feedback/InlineLoading'
import { PageLayout } from '../../components/layout/PageLayout'

export function AdminBusinessStrategyPage(): ReactElement {
  const { businessId } = useParams<{ businessId: string }>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [businessContext, setBusinessContext] = useState<BusinessContextDto | null>(null)
  const [susoMatrix, setSusoMatrix] = useState<SusoMatrixPreview | null>(null)

  useEffect(() => {
    if (!businessId) return
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await getBusinessContext(businessId)
        if (cancelled) return
        setBusinessContext(res.businessContext)
        setSusoMatrix(res.susoMatrix ?? null)
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiError) setError(err.message)
        else setError('Could not load business strategy.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [businessId])

  if (!businessId) {
    return (
      <PageLayout title="Business strategy">
        <ErrorAlert message="Missing business id." />
      </PageLayout>
    )
  }

  if (loading) {
    return (
      <PageLayout title="Business strategy">
        <InlineLoading label="Loading business strategy…" />
      </PageLayout>
    )
  }

  if (!businessContext) {
    return (
      <PageLayout title="Business strategy">
        <ErrorAlert message={error ?? 'Business not found.'} />
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title={businessContext.businessName ?? 'Business strategy'}
      lead="Business-level strategy and derived objectives preview."
    >
      <div className="actions" style={{ marginBottom: '1.5rem' }}>
        <Link className="btn btn-secondary" to="/admin">
          Back to admin console
        </Link>
      </div>
      <ErrorAlert message={error} />

      <section>
        <h2>Business strategy</h2>
        <p style={{ color: 'var(--color-muted)', marginTop: 0 }}>
          Business-level strategy and derived objectives preview.
        </p>
        <AdminBusinessStrategySection
          businessId={businessId}
          initial={businessContext}
          matrix={susoMatrix}
          onSaved={(nextContext, nextMatrix) => {
            setBusinessContext(nextContext)
            setSusoMatrix(nextMatrix)
          }}
        />
      </section>
    </PageLayout>
  )
}
