import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
import { ApiError } from '../../api/client'
import {
  enableAdsCampaign,
  getAdsCampaign,
  pauseAdsCampaign,
  updateAdsCampaignBudget,
  type AdsCampaignState,
} from '../../api/adsManagement'
import { ErrorAlert } from '../feedback/ErrorAlert'
import { InlineLoading } from '../feedback/InlineLoading'

const MICROS_PER_UNIT = 1_000_000

function microsToUnits(amountMicros: number | null | undefined): string {
  if (amountMicros == null || !Number.isFinite(amountMicros)) return ''
  return String(amountMicros / MICROS_PER_UNIT)
}

function unitsToMicros(raw: string): number | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.round(parsed * MICROS_PER_UNIT)
}

interface EnableCampaignCardProps {
  businessId: string
}

export function EnableCampaignCard({ businessId }: EnableCampaignCardProps): ReactElement {
  const [campaign, setCampaign] = useState<AdsCampaignState | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [budgetInput, setBudgetInput] = useState('')
  const [showEnableConfirm, setShowEnableConfirm] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const { campaign: loaded } = await getAdsCampaign(businessId)
        if (cancelled) return
        setCampaign(loaded)
        setBudgetInput(microsToUnits(loaded.amountMicros))
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiError) setError(err.message)
        else setError('Could not load campaign status.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [businessId])

  async function refreshCampaign(): Promise<void> {
    const { campaign: loaded } = await getAdsCampaign(businessId)
    setCampaign(loaded)
    setBudgetInput(microsToUnits(loaded.amountMicros))
  }

  async function onEnableConfirmed(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await enableAdsCampaign(businessId)
      setShowEnableConfirm(false)
      await refreshCampaign()
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not enable the campaign.')
    } finally {
      setBusy(false)
    }
  }

  async function onPause(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await pauseAdsCampaign(businessId)
      await refreshCampaign()
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not pause the campaign.')
    } finally {
      setBusy(false)
    }
  }

  async function onBudgetSubmit(e: FormEvent): Promise<void> {
    e.preventDefault()
    const amountMicros = unitsToMicros(budgetInput)
    if (!amountMicros) {
      setError('Enter a valid daily budget greater than zero.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await updateAdsCampaignBudget(businessId, amountMicros)
      await refreshCampaign()
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not update the campaign budget.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <InlineLoading label="Loading campaign status…" />
  }

  if (!campaign) {
    return <ErrorAlert message={error ?? 'Campaign status is unavailable.'} />
  }

  const isEnabled = campaign.status === 'ENABLED'
  const isPaused = campaign.status === 'PAUSED'

  return (
    <section style={{ marginTop: '1.5rem' }}>
      <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Campaign management</h2>
      <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginTop: 0 }}>
        Your Google Ads campaign was created paused. Enable it here when you are ready to start
        spending, or adjust the daily budget before enabling.
      </p>
      <ErrorAlert message={error} />
      <div style={{ marginTop: '0.75rem' }}>
        <span className={`statusPill ${isEnabled ? 'status-succeeded' : 'status-review'}`}>
          {campaign.status}
        </span>
        {campaign.amountMicros != null ? (
          <span style={{ marginLeft: '0.5rem', fontSize: '0.875rem' }}>
            Daily budget: ${microsToUnits(campaign.amountMicros)}
          </span>
        ) : null}
      </div>
      <div className="actions" style={{ marginTop: '0.75rem' }}>
        {isPaused ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => setShowEnableConfirm(true)}
          >
            Enable campaign
          </button>
        ) : null}
        {isEnabled ? (
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void onPause()}>
            {busy ? <InlineLoading label="Pausing…" /> : 'Pause campaign'}
          </button>
        ) : null}
      </div>
      <form className="form" style={{ marginTop: '1rem', maxWidth: '20rem' }} onSubmit={(e) => void onBudgetSubmit(e)}>
        <div className="field">
          <label htmlFor="dailyBudget">Daily budget (USD)</label>
          <input
            id="dailyBudget"
            type="number"
            min="1"
            step="0.01"
            value={budgetInput}
            onChange={(e) => setBudgetInput(e.target.value)}
            disabled={busy}
          />
        </div>
        <button type="submit" className="btn btn-secondary" disabled={busy}>
          {busy ? <InlineLoading label="Saving…" /> : 'Update budget'}
        </button>
      </form>

      {showEnableConfirm ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="enable-campaign-title"
          className="alert alert-info"
          style={{ marginTop: '1rem', maxWidth: '36rem' }}
        >
          <h3 id="enable-campaign-title" style={{ fontSize: '1rem', marginTop: 0 }}>
            Enable this Google Ads campaign?
          </h3>
          <p style={{ fontSize: '0.9rem' }}>
            Enabling will start ad delivery and spend against your daily budget in Google Ads. You
            can pause the campaign here later if needed.
          </p>
          <div className="actions">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void onEnableConfirmed()}
            >
              {busy ? <InlineLoading label="Enabling…" /> : 'Yes, enable campaign'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowEnableConfirm(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
