import { useEffect, useState, type ReactElement } from 'react'

import { Link, useParams } from 'react-router-dom'

import { ApiError } from '../../api/client'

import { getBusinessContext } from '../../api/businessContexts'

import type { BusinessContextDto } from '../../types/api'

import { AdminBusinessSetupSection } from '../../components/admin/AdminBusinessSetupSection'
import { AdminFiveAnswerReviewSection } from '../../components/admin/AdminFiveAnswerReviewSection'
import { AdminLeadCampaignReviewSection } from '../../components/admin/AdminLeadCampaignReviewSection'
import { AdminSetupCallSection } from '../../components/admin/AdminSetupCallSection'

import { ErrorAlert } from '../../components/feedback/ErrorAlert'

import { InlineLoading } from '../../components/feedback/InlineLoading'

import { PageLayout } from '../../components/layout/PageLayout'



export function AdminBusinessWorkspacePage(): ReactElement {

  const { businessId } = useParams<{ businessId: string }>()

  const [loading, setLoading] = useState(true)

  const [error, setError] = useState<string | null>(null)

  const [businessContext, setBusinessContext] = useState<BusinessContextDto | null>(null)



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

      } catch (err) {

        if (cancelled) return

        if (err instanceof ApiError) setError(err.message)

        else setError('Could not load business workspace.')

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

      <PageLayout title="Business setup">

        <ErrorAlert message="Missing business id." />

      </PageLayout>

    )

  }



  if (loading) {

    return (

      <PageLayout title="Business setup">

        <InlineLoading label="Loading business setup…" />

      </PageLayout>

    )

  }



  if (!businessContext) {

    return (

      <PageLayout title="Business setup">

        <ErrorAlert message={error ?? 'Business not found.'} />

      </PageLayout>

    )

  }



  return (

    <PageLayout

      title={businessContext.businessName ?? 'Business setup'}

      lead="Facts that stay true even if ads never run."

    >

      <div className="actions" style={{ marginBottom: '1.5rem' }}>

        <Link className="btn btn-secondary" to="/admin">

          Back to admin console

        </Link>

      </div>

      <ErrorAlert message={error} />



      <section>

        <h2>Business setup</h2>

        <p style={{ color: 'var(--color-muted)', marginTop: 0 }}>

          Facts that stay true even if ads never run.

        </p>

        <AdminBusinessSetupSection

          businessId={businessId}

          initial={businessContext}

          onSaved={setBusinessContext}

        />

      </section>

      <AdminFiveAnswerReviewSection
        businessId={businessId}
        initial={businessContext}
        onSaved={setBusinessContext}
      />

      <AdminSetupCallSection
        businessId={businessId}
        businessContext={businessContext}
        onRecorded={(setupCallConfirmedAt) =>
          setBusinessContext((prev) =>
            prev ? { ...prev, setupCallConfirmedAt } : prev,
          )
        }
      />

      <AdminLeadCampaignReviewSection businessId={businessId} />

    </PageLayout>

  )

}


