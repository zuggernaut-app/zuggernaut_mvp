import { useCallback, useEffect, useState, type ReactElement } from 'react'

import { ApiError } from '../../api/client'
import {
  confirmLeadCampaignBudget,
  enableLeadCampaignSlot,
  getLeadCampaignDashboard,
  pauseLeadCampaignSlot,
  type LeadCampaignSlotName,
  type LeadCampaignSlotState,
} from '../../api/leadCampaigns'
import { getAdsCampaignPerformance, type CampaignPerformanceMetrics } from '../../api/adsPerformance'
import { ErrorAlert } from '../feedback/ErrorAlert'
import { InlineLoading } from '../feedback/InlineLoading'

type SlotPerformance = {
  metrics: CampaignPerformanceMetrics
  source: string
} | null

function formatMicros(micros: number | null | undefined, currency = 'USD'): string {
  if (micros == null) return '—'
  const amount = micros / 1_000_000
  try {
    return `${new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount)}/day`
  } catch {
    return `${amount.toFixed(2)} ${currency}/day`
  }
}

function blockedLabel(slot: LeadCampaignSlotState): string | null {
  if (!slot.blocked) return null
  if (slot.blocked.customerMessage === 'waiting_on_you') return 'Waiting on you'
  return "We're working on it"
}

function formatCostPerResult(
  costMicros: number,
  results: number,
  currency: string,
): string {
  if (results <= 0) return '—'
  const amount = costMicros / 1_000_000 / results
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}

function resultLabel(action: LeadCampaignSlotState['action']): string {
  return action === 'calls' ? 'calls' : 'form leads'
}

interface LeadCampaignDashboardProps {
  businessId: string
}

export function LeadCampaignDashboard({ businessId }: LeadCampaignDashboardProps): ReactElement {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busySlot, setBusySlot] = useState<LeadCampaignSlotName | null>(null)
  const [slots, setSlots] = useState<{
    recommended: LeadCampaignSlotState | null
    alternative: LeadCampaignSlotState | null
  }>({ recommended: null, alternative: null })
  const [performance, setPerformance] = useState<{
    recommended: SlotPerformance
    alternative: SlotPerformance
  }>({ recommended: null, alternative: null })
  const [currency, setCurrency] = useState('USD')
  const [budgetFloorMicros, setBudgetFloorMicros] = useState<number | null>(null)
  const [budgetCeilingMicros, setBudgetCeilingMicros] = useState<number | null>(null)
  const [budgetInputs, setBudgetInputs] = useState<Record<LeadCampaignSlotName, string>>({
    recommended: '',
    alternative: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const dashboard = await getLeadCampaignDashboard(businessId)
      setSlots(dashboard.slots)
      setCurrency(dashboard.currency ?? 'USD')
      setBudgetFloorMicros(dashboard.budgetFloorMicros ?? null)
      setBudgetCeilingMicros(dashboard.budgetCeilingMicros ?? null)
      setBudgetInputs({
        recommended: dashboard.slots.recommended?.committedBudgetMicros
          ? String(dashboard.slots.recommended.committedBudgetMicros / 1_000_000)
          : '',
        alternative: dashboard.slots.alternative?.committedBudgetMicros
          ? String(dashboard.slots.alternative.committedBudgetMicros / 1_000_000)
          : '',
      })
      try {
        const perf = await getAdsCampaignPerformance(businessId)
        setPerformance({
          recommended: perf.performance.slots?.recommended ?? null,
          alternative: perf.performance.slots?.alternative ?? null,
        })
      } catch {
        setPerformance({ recommended: null, alternative: null })
      }
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not load campaigns.')
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    void load()
  }, [load])

  async function runSlotAction(
    slot: LeadCampaignSlotName,
    action: () => Promise<unknown>,
  ): Promise<void> {
    setBusySlot(slot)
    setError(null)
    try {
      await action()
      await load()
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Action failed.')
    } finally {
      setBusySlot(null)
    }
  }

  if (loading) {
    return <InlineLoading label="Loading campaigns…" />
  }

  const entries = (['recommended', 'alternative'] as LeadCampaignSlotName[])
    .map((name) => ({ name, slot: slots[name] }))
    .filter((entry) => entry.slot != null)

  if (entries.length === 0) {
    return (
      <p style={{ color: 'var(--color-muted)' }}>
        Your campaigns are being prepared. Check back soon.
      </p>
    )
  }

  return (
    <div className="stack" style={{ gap: '1.25rem' }}>
      {error ? <ErrorAlert message={error} /> : null}
      {entries.map(({ name, slot }) => {
        if (!slot) return null
        const perf = performance[name]
        const blocked = blockedLabel(slot)
        const isRetired = slot.reviewStatus === 'retired'
        const isEnabled = slot.liveStatus === 'ENABLED'
        const canStart =
          slot.reviewStatus === 'approved' &&
          Boolean(slot.budgetConfirmedAt) &&
          !blocked &&
          !isRetired
        const budgetMajor = budgetInputs[name]
        const parsedBudgetMicros = Number(budgetMajor) > 0
          ? Math.round(Number(budgetMajor) * 1_000_000)
          : null

        return (
          <section
            key={name}
            style={{
              border: '1px solid var(--color-border, #ddd)',
              borderRadius: '8px',
              padding: '1rem',
            }}
          >
            <h2 style={{ marginTop: 0, textTransform: 'capitalize' }}>{name}</h2>
            <p style={{ margin: '0 0 0.5rem', color: 'var(--color-muted)' }}>
              {slot.offer ?? 'Lead campaign'} · {slot.action ?? 'forms'}
            </p>
            <p style={{ margin: '0 0 0.5rem' }}>
              Status: <strong>{slot.liveStatus ?? 'PAUSED'}</strong>
              {slot.reviewStatus ? ` · Review: ${slot.reviewStatus}` : null}
            </p>
            {blocked ? (
              <p style={{ margin: '0 0 0.75rem', color: 'var(--color-muted)' }}>{blocked}</p>
            ) : null}
            <p style={{ margin: '0 0 0.5rem' }}>
              Budget: {formatMicros(slot.amountMicros ?? slot.committedBudgetMicros, currency)}
            </p>
            {!slot.budgetConfirmedAt ? (
              <label style={{ display: 'block', marginBottom: '0.75rem' }}>
                <span style={{ display: 'block', marginBottom: '0.25rem' }}>
                  Daily budget ({currency})
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={budgetInputs[name]}
                  onChange={(event) =>
                    setBudgetInputs((prev) => ({ ...prev, [name]: event.target.value }))
                  }
                  style={{ width: '100%', maxWidth: '12rem' }}
                />
                {budgetFloorMicros != null && budgetCeilingMicros != null ? (
                  <span style={{ display: 'block', fontSize: '0.85rem', color: 'var(--color-muted)' }}>
                    Allowed range: {formatMicros(budgetFloorMicros, currency)} –{' '}
                    {formatMicros(budgetCeilingMicros, currency)}
                  </span>
                ) : null}
              </label>
            ) : null}
            {perf?.metrics ? (
              <p style={{ margin: '0 0 0.75rem', fontSize: '0.9rem', color: 'var(--color-muted)' }}>
                Last {perf.metrics.dateRangeDays} days: {perf.metrics.conversions}{' '}
                {resultLabel(slot.action)}, cost per result{' '}
                {formatCostPerResult(perf.metrics.costMicros, perf.metrics.conversions, currency)}
              </p>
            ) : null}
            <div className="cluster" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
              {!slot.budgetConfirmedAt ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busySlot === name || !parsedBudgetMicros}
                  onClick={() =>
                    void runSlotAction(name, () =>
                      confirmLeadCampaignBudget(businessId, name, parsedBudgetMicros as number),
                    )
                  }
                >
                  Confirm budget
                </button>
              ) : null}
              {canStart && !isEnabled ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busySlot === name}
                  onClick={() =>
                    void runSlotAction(name, () => enableLeadCampaignSlot(businessId, name))
                  }
                >
                  Start campaign
                </button>
              ) : null}
              {isEnabled ? (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busySlot === name}
                  onClick={() =>
                    void runSlotAction(name, () => pauseLeadCampaignSlot(businessId, name))
                  }
                >
                  Pause
                </button>
              ) : null}
            </div>
          </section>
        )
      })}
      <p>
        <a className="btn btn-secondary" href="/billing">Billing & subscription</a>
      </p>
    </div>
  )
}
