import { useEffect, useState, type ReactElement } from 'react'
import { ApiError } from '../../api/client'
import {
  fetchGoogleAdsResourceOptions,
  saveGoogleAdsSelection,
  type GoogleAdsCustomerOption,
} from '../../api/integrations'
import { ErrorAlert } from '../feedback/ErrorAlert'
import { InlineLoading } from '../feedback/InlineLoading'

interface GoogleAdsCustomerSelectorProps {
  businessId: string
  onSaved: () => void
}

function customerLabel(option: GoogleAdsCustomerOption): string {
  const name = option.descriptiveName ?? 'Unnamed account'
  return `${name} (${option.formattedCustomerId})`
}

export function GoogleAdsCustomerSelector({
  businessId,
  onSaved,
}: GoogleAdsCustomerSelectorProps): ReactElement {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [customerId, setCustomerId] = useState('')
  const [options, setOptions] = useState<GoogleAdsCustomerOption[]>([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        const { result } = await fetchGoogleAdsResourceOptions(businessId)
        if (cancelled) return
        if (result.reason === 'ADS_PROVISIONING_REQUIRED') {
          setError('No accessible Google Ads customers were found. Provisioning approval is required instead.')
          setOptions([])
          return
        }
        if (result.reason === 'ADS_CUSTOMER_NOT_FOUND') {
          setError(
            'No accessible Google Ads customer was found for this Google account. Create a Google Ads account at ads.google.com (or connect a different Google account), then return here.',
          )
          setOptions([])
          return
        }
        setOptions(result.options)
        const initial =
          result.selected?.customerId ??
          result.suggestedCustomerId ??
          result.options.find((row) => row.selectable)?.customerId ??
          ''
        setCustomerId(initial)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Could not load Google Ads customers.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [businessId])

  async function saveSelection(): Promise<void> {
    if (!customerId) return
    setBusy(true)
    setError(null)
    try {
      await saveGoogleAdsSelection({ businessId, customerId })
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save Google Ads selection.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <InlineLoading label="Loading Google Ads customers…" />
  }

  const selected = options.find((row) => row.customerId === customerId)

  return (
    <div className="form" style={{ marginTop: '0.75rem' }}>
      <ErrorAlert message={error} />
      <div className="field">
        <label htmlFor="adsCustomer">Google Ads customer</label>
        <select
          id="adsCustomer"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
        >
          {options.map((option) => (
            <option
              key={option.customerId}
              value={option.customerId}
              disabled={!option.selectable}
            >
              {customerLabel(option)}
              {option.nonSelectableReason ? ` — ${option.nonSelectableReason}` : ''}
            </option>
          ))}
        </select>
      </div>
      {selected && !selected.selectable && selected.nonSelectableReason ? (
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)' }}>
          {selected.nonSelectableReason}
        </p>
      ) : null}
      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy || !customerId || selected?.selectable === false}
        onClick={() => void saveSelection()}
      >
        {busy ? <InlineLoading label="Saving…" /> : 'Save Google Ads selection'}
      </button>
    </div>
  )
}
