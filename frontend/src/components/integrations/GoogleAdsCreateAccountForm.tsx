import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { ApiError } from '../../api/client'
import { createGoogleAdsAccount } from '../../api/integrations'
import {
  defaultGoogleAdsTimeZoneSelection,
  GOOGLE_ADS_CURRENCY_CODES,
  GOOGLE_ADS_TIME_ZONE_IDS,
} from '../../lib/googleAdsStaticData'
import { ErrorAlert } from '../feedback/ErrorAlert'
import { InlineLoading } from '../feedback/InlineLoading'

interface GoogleAdsCreateAccountFormProps {
  businessId: string
  onCreated: () => void
}

function SearchableSelect({
  id,
  label,
  value,
  options,
  onChange,
  note,
}: {
  id: string
  label: string
  value: string
  options: readonly string[]
  onChange: (next: string) => void
  note?: string
}): ReactElement {
  const [query, setQuery] = useState(value)
  useEffect(() => {
    setQuery(value)
  }, [value])
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options.slice(0, 200)
    return options.filter((opt) => opt.toLowerCase().includes(q)).slice(0, 200)
  }, [options, query])

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        list={`${id}-list`}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          const exact = options.find((opt) => opt.toLowerCase() === e.target.value.trim().toLowerCase())
          if (exact) onChange(exact)
          else if (!e.target.value.trim()) onChange('')
        }}
        onBlur={() => {
          const exact = options.find((opt) => opt.toLowerCase() === query.trim().toLowerCase())
          if (exact) {
            onChange(exact)
            setQuery(exact)
          }
        }}
        placeholder="Type to search…"
        autoComplete="off"
      />
      <datalist id={`${id}-list`}>
        {filtered.map((opt) => (
          <option key={opt} value={opt} />
        ))}
      </datalist>
      {note ? (
        <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', margin: '0.35rem 0 0' }}>{note}</p>
      ) : null}
    </div>
  )
}

export function GoogleAdsCreateAccountForm({
  businessId,
  onCreated,
}: GoogleAdsCreateAccountFormProps): ReactElement {
  const initialTimeZone = defaultGoogleAdsTimeZoneSelection()
  const [currencyCode, setCurrencyCode] = useState('')
  const [timeZone, setTimeZone] = useState(initialTimeZone)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const permanenceNote = 'This cannot be changed after the account is created.'

  async function onSubmit(): Promise<void> {
    if (!currencyCode || !timeZone) return
    setBusy(true)
    setError(null)
    try {
      await createGoogleAdsAccount({ businessId, currencyCode, timeZone })
      onCreated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create Google Ads account.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="form" style={{ marginTop: '0.75rem' }}>
      <ErrorAlert message={error} />
      <SearchableSelect
        id="ads-create-currency"
        label="Account currency"
        value={currencyCode}
        options={GOOGLE_ADS_CURRENCY_CODES}
        onChange={setCurrencyCode}
        note={permanenceNote}
      />
      <SearchableSelect
        id="ads-create-timezone"
        label="Account time zone"
        value={timeZone || initialTimeZone}
        options={GOOGLE_ADS_TIME_ZONE_IDS}
        onChange={setTimeZone}
        note={permanenceNote}
      />
      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy || !currencyCode || !timeZone}
        onClick={() => void onSubmit()}
      >
        {busy ? <InlineLoading label="Creating…" /> : 'Create account'}
      </button>
    </div>
  )
}
