import { type FormEvent, useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { ApiError } from '../../api/client'
import { updateBusinessContext } from '../../api/businessContexts'
import { SusoMatrixPreview } from '../setup/SusoMatrixPreview'
import { ErrorAlert } from '../feedback/ErrorAlert'
import { InlineLoading } from '../feedback/InlineLoading'
import type {
  BusinessContextDto,
  BusinessContextUpdateBody,
  SusoBudgetTier,
  SusoBusinessScope,
  SusoCompetitorEntry,
  SusoMatrixPreview as SusoMatrixPreviewData,
  SusoValueComplexity,
} from '../../types/api'
import { splitLines } from './adminWorkspaceUtils'

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

interface AdminBusinessStrategySectionProps {
  businessId: string
  initial: BusinessContextDto
  matrix: SusoMatrixPreviewData | null
  onSaved: (businessContext: BusinessContextDto, matrix: SusoMatrixPreviewData | null) => void
}

export function AdminBusinessStrategySection({
  businessId,
  initial,
  matrix,
  onSaved,
}: AdminBusinessStrategySectionProps): ReactElement {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedNotice, setSavedNotice] = useState<string | null>(null)
  const [form, setForm] = useState({
    services: '',
    uvp: '',
    differentiators: '',
    differentiationAngle: '',
    competitors: [{ name: '', differentiation: '' }, { name: '', differentiation: '' }] as SusoCompetitorEntry[],
    businessScope: '' as SusoBusinessScope | '',
    valueComplexity: '' as SusoValueComplexity | '',
    budgetTier: '' as SusoBudgetTier | '',
  })

  useEffect(() => {
    const competitors = readCompetitors(initial.competitorLandscape)
    const angle =
      initial.competitorLandscape &&
      typeof initial.competitorLandscape === 'object' &&
      !Array.isArray(initial.competitorLandscape) &&
      typeof (initial.competitorLandscape as { differentiationAngle?: unknown }).differentiationAngle ===
        'string'
        ? String((initial.competitorLandscape as { differentiationAngle: string }).differentiationAngle)
        : ''
    setForm({
      services: (initial.services ?? []).join('\n'),
      uvp: initial.uvp ?? initial.differentiators ?? '',
      differentiators: initial.differentiators ?? '',
      differentiationAngle: angle,
      competitors,
      businessScope: (initial.businessScope as SusoBusinessScope | null) ?? '',
      valueComplexity: (initial.valueComplexity as SusoValueComplexity | null) ?? '',
      budgetTier: (initial.budgetTier as SusoBudgetTier | null) ?? '',
    })
  }, [initial])

  async function onSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setError(null)
    setSavedNotice(null)

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
        services: splitLines(form.services),
        uvp: form.uvp.trim(),
        differentiators: form.differentiators.trim() || undefined,
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
      onSaved(saved.businessContext, saved.susoMatrix ?? null)
      setSavedNotice('Business strategy saved.')
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not save business strategy.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: '40rem' }}>
      <form className="form-stack" onSubmit={(e) => void onSubmit(e)}>
        <ErrorAlert message={error} />
        {savedNotice ? (
          <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
            {savedNotice}
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="admin-services">What you sell (one per line)</label>
          <textarea
            id="admin-services"
            value={form.services}
            onChange={(e) => setForm((f) => ({ ...f, services: e.target.value }))}
          />
        </div>

        <label className="field">
          <span className="field-label">Unique value proposition</span>
          <textarea
            className="input"
            rows={4}
            value={form.uvp}
            onChange={(e) => setForm((f) => ({ ...f, uvp: e.target.value }))}
          />
        </label>

        <div className="field">
          <label htmlFor="admin-differentiators">Differentiators</label>
          <textarea
            id="admin-differentiators"
            value={form.differentiators}
            onChange={(e) => setForm((f) => ({ ...f, differentiators: e.target.value }))}
          />
        </div>

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

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save business strategy'}
          </button>
        </div>
      </form>

      <section style={{ marginTop: '2rem' }} aria-label="Objectives preview">
        <h3 className="h4">Objectives preview</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Derived from strategy inputs. Read-only for V1.
        </p>
        <SusoMatrixPreview matrix={matrix} />
      </section>
    </div>
  )
}
