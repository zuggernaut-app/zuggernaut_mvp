import { type FormEvent, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { getBusinessContext, updateBusinessContext } from '../api/businessContexts'
import { SusoMatrixPreview } from '../components/setup/SusoMatrixPreview'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'
import { useOnboardingState } from '../hooks/useOnboardingState'
import type {
  BusinessContextUpdateBody,
  SusoBudgetTier,
  SusoBusinessScope,
  SusoCompetitorEntry,
  SusoMatrixPreview as SusoMatrixPreviewData,
  SusoValueComplexity,
} from '../types/api'

const BUSINESS_SCOPE_OPTIONS: { value: SusoBusinessScope; label: string }[] = [
  { value: 'local_service', label: 'Local service' },
  { value: 'regional', label: 'Regional' },
  { value: 'national_online', label: 'National / online' },
]

const VALUE_COMPLEXITY_OPTIONS: { value: SusoValueComplexity; label: string }[] = [
  { value: 'low_value_low_complexity', label: 'Low value / low complexity' },
  { value: 'low_value_high_complexity', label: 'Low value / high complexity' },
  { value: 'high_value_low_complexity', label: 'High value / low complexity' },
  { value: 'high_value_high_complexity', label: 'High value / high complexity' },
]

const BUDGET_TIER_OPTIONS: { value: SusoBudgetTier; label: string }[] = [
  { value: 'starter', label: 'Starter' },
  { value: 'growth', label: 'Growth' },
  { value: 'scale', label: 'Scale' },
]

function readCompetitors(landscape: unknown): SusoCompetitorEntry[] {
  if (!landscape || typeof landscape !== 'object' || Array.isArray(landscape)) {
    return [{ name: '' }, { name: '' }]
  }
  const rows = (landscape as { competitors?: unknown }).competitors
  if (!Array.isArray(rows) || rows.length === 0) {
    return [{ name: '' }, { name: '' }]
  }
  return rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      return { name: '' }
    }
    const r = row as Record<string, unknown>
    return {
      name: typeof r.name === 'string' ? r.name : '',
      differentiation: typeof r.differentiation === 'string' ? r.differentiation : '',
    }
  })
}

export function Step0BusinessFoundationPage(): ReactElement {
  const navigate = useNavigate()
  const { snapshot } = useOnboardingState()
  const { businessId } = snapshot

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [matrix, setMatrix] = useState<SusoMatrixPreviewData | null>(null)
  const [form, setForm] = useState({
    uvp: '',
    differentiationAngle: '',
    competitors: [{ name: '', differentiation: '' }, { name: '', differentiation: '' }] as SusoCompetitorEntry[],
    businessScope: '' as SusoBusinessScope | '',
    valueComplexity: '' as SusoValueComplexity | '',
    budgetTier: '' as SusoBudgetTier | '',
  })

  useEffect(() => {
    if (!businessId) {
      navigate('/onboarding/business', { replace: true })
      return
    }
    let cancelled = false
    void (async () => {
      setLoading(true)
      try {
        const res = await getBusinessContext(businessId)
        if (cancelled) return
        const bc = res.businessContext
        const competitors = readCompetitors(bc.competitorLandscape)
        const angle =
          bc.competitorLandscape &&
          typeof bc.competitorLandscape === 'object' &&
          !Array.isArray(bc.competitorLandscape) &&
          typeof (bc.competitorLandscape as { differentiationAngle?: unknown }).differentiationAngle ===
            'string'
            ? String((bc.competitorLandscape as { differentiationAngle: string }).differentiationAngle)
            : ''
        setForm({
          uvp: bc.uvp ?? bc.differentiators ?? '',
          differentiationAngle: angle,
          competitors,
          businessScope: (bc.businessScope as SusoBusinessScope | null) ?? '',
          valueComplexity: (bc.valueComplexity as SusoValueComplexity | null) ?? '',
          budgetTier: (bc.budgetTier as SusoBudgetTier | null) ?? '',
        })
        setMatrix(res.susoMatrix ?? null)
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiError) setError(err.message)
        else setError('Could not load business context.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [businessId, navigate])

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    if (!businessId) return
    setError(null)

    if (!form.uvp.trim()) {
      setError('UVP is required.')
      return
    }
    if (!form.businessScope || !form.valueComplexity || !form.budgetTier) {
      setError('Business scope, value×complexity, and budget tier are required.')
      return
    }

    const competitors = form.competitors
      .map((c) => ({
        name: c.name.trim(),
        ...(c.differentiation?.trim() ? { differentiation: c.differentiation.trim() } : {}),
      }))
      .filter((c) => c.name)

    setBusy(true)
    try {
      const body: BusinessContextUpdateBody = {
        uvp: form.uvp.trim(),
        competitorLandscape: {
          competitors,
          ...(form.differentiationAngle.trim()
            ? { differentiationAngle: form.differentiationAngle.trim() }
            : {}),
        },
        businessScope: form.businessScope,
        valueComplexity: form.valueComplexity,
        budgetTier: form.budgetTier,
      }
      const saved = await updateBusinessContext(businessId, body)
      setMatrix(saved.susoMatrix ?? null)
      navigate('/setup', { replace: true })
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not save Step 0 foundation.')
    } finally {
      setBusy(false)
    }
  }

  if (!businessId) {
    return (
      <PageLayout title="Business foundation">
        <InlineLoading />
      </PageLayout>
    )
  }

  if (loading) {
    return (
      <PageLayout title="Business foundation">
        <InlineLoading />
      </PageLayout>
    )
  }

  return (
    <PageLayout
      title="Business foundation (Step 0)"
      lead="Define your positioning and scope so we can build the right Search strategy."
    >
      {error ? <ErrorAlert message={error} /> : null}

      <form className="form-stack" onSubmit={(e) => void onSubmit(e)}>
        <label className="field">
          <span className="field-label">Unique value proposition</span>
          <textarea
            className="input"
            rows={4}
            value={form.uvp}
            onChange={(e) => setForm((f) => ({ ...f, uvp: e.target.value }))}
            placeholder="What makes your business different?"
          />
        </label>

        <fieldset className="field">
          <legend className="field-label">Competitor landscape (2–3 named competitors)</legend>
          {form.competitors.map((competitor, idx) => (
            <div key={idx} className="form-row">
              <input
                className="input"
                placeholder={`Competitor ${idx + 1} name`}
                value={competitor.name}
                onChange={(e) =>
                  setForm((f) => {
                    const next = [...f.competitors]
                    next[idx] = { ...next[idx], name: e.target.value }
                    return { ...f, competitors: next }
                  })
                }
              />
              <input
                className="input"
                placeholder="Differentiation angle (optional)"
                value={competitor.differentiation ?? ''}
                onChange={(e) =>
                  setForm((f) => {
                    const next = [...f.competitors]
                    next[idx] = { ...next[idx], differentiation: e.target.value }
                    return { ...f, competitors: next }
                  })
                }
              />
            </div>
          ))}
          <label className="field">
            <span className="field-label">Overall differentiation angle (optional)</span>
            <input
              className="input"
              value={form.differentiationAngle}
              onChange={(e) => setForm((f) => ({ ...f, differentiationAngle: e.target.value }))}
            />
          </label>
        </fieldset>

        <label className="field">
          <span className="field-label">Business scope</span>
          <select
            className="input"
            value={form.businessScope}
            onChange={(e) =>
              setForm((f) => ({ ...f, businessScope: e.target.value as SusoBusinessScope }))
            }
          >
            <option value="">Select scope…</option>
            {BUSINESS_SCOPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Order value × technical complexity</span>
          <select
            className="input"
            value={form.valueComplexity}
            onChange={(e) =>
              setForm((f) => ({ ...f, valueComplexity: e.target.value as SusoValueComplexity }))
            }
          >
            <option value="">Select profile…</option>
            {VALUE_COMPLEXITY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          <span className="field-label">Budget tier</span>
          <select
            className="input"
            value={form.budgetTier}
            onChange={(e) =>
              setForm((f) => ({ ...f, budgetTier: e.target.value as SusoBudgetTier }))
            }
          >
            <option value="">Select tier…</option>
            {BUDGET_TIER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <SusoMatrixPreview matrix={matrix} />

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Continue to setup'}
          </button>
        </div>
      </form>
    </PageLayout>
  )
}
