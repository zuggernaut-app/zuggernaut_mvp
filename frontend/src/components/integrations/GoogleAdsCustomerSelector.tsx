import { useEffect, useState, type ReactElement } from 'react'

import { ApiError } from '../../api/client'

import {

  fetchGoogleAdsResourceOptions,

  saveGoogleAdsProvisioningIntent,

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

  const [selectionReason, setSelectionReason] = useState<string | null>(null)

  const [showConfirm, setShowConfirm] = useState(false)



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

          setSelectionReason(null)

          return

        }

        if (result.reason === 'ADS_CUSTOMER_NOT_FOUND') {

          setError(

            'No accessible Google Ads customer was found for this Google account. Create a Google Ads account at ads.google.com (or connect a different Google account), then return here.',

          )

          setOptions([])

          setSelectionReason(null)

          return

        }

        setOptions(result.options)

        setSelectionReason(result.reason)

        const initial =

          result.selected?.customerId ??

          result.suggestedCustomerId ??

          result.options.find((row) => row.selectable)?.customerId ??

          ''

        setCustomerId(initial)

        setShowConfirm(false)

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



  async function saveMccCreateIntent(): Promise<void> {

    setBusy(true)

    setError(null)

    try {

      await saveGoogleAdsProvisioningIntent(businessId)

      onSaved()

    } catch (err) {

      setError(

        err instanceof ApiError

          ? err.message

          : 'Could not save Google Ads provisioning intent.',

      )

    } finally {

      setBusy(false)

    }

  }



  if (loading) {

    return <InlineLoading label="Loading Google Ads customers…" />

  }



  const selected = options.find((row) => row.customerId === customerId)

  const showMccCreate =

    selectionReason === 'ADS_CUSTOMER_SELECTION_REQUIRED' && options.length > 0

  const canReview =

    Boolean(selected) && selected?.selectable !== false && Boolean(customerId)



  return (

    <div className="form" style={{ marginTop: '0.75rem' }}>

      <ErrorAlert message={error} />

      <div className="field">

        <label htmlFor="adsCustomer">Google Ads customer</label>

        <select

          id="adsCustomer"

          value={customerId}

          onChange={(e) => {

            setCustomerId(e.target.value)

            setShowConfirm(false)

          }}

        >

          {options.map((option) => (

            <option

              key={option.customerId}

              value={option.customerId}

              disabled={!option.selectable}

            >

              {customerLabel(option)}

              {option.status ? ` · ${option.status}` : ''}

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

      {showConfirm && selected ? (

        <section

          aria-label="Google Ads selection confirmation"

          style={{

            marginTop: '0.75rem',

            padding: '0.75rem',

            border: '1px solid var(--color-border, #ccc)',

            borderRadius: '4px',

          }}

        >

          <h3 style={{ margin: '0 0 0.5rem', fontSize: '0.95rem' }}>Confirm Google Ads account</h3>

          <dl style={{ margin: 0, fontSize: '0.875rem' }}>

            <div>

              <dt>Name</dt>

              <dd>{selected.descriptiveName ?? 'Unnamed account'}</dd>

            </div>

            <div>

              <dt>Customer ID</dt>

              <dd>{selected.formattedCustomerId}</dd>

            </div>

            <div>

              <dt>Status</dt>

              <dd>{selected.status ?? 'unknown'}</dd>

            </div>

            <div>

              <dt>Account type</dt>

              <dd>{selected.kind}</dd>

            </div>

          </dl>

        </section>

      ) : null}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '0.75rem' }}>

        {!showConfirm ? (

          <button

            type="button"

            className="btn btn-secondary"

            disabled={busy || !canReview}

            onClick={() => setShowConfirm(true)}

          >

            Review selection

          </button>

        ) : (

          <button

            type="button"

            className="btn btn-secondary"

            disabled={busy || !canReview}

            onClick={() => void saveSelection()}

          >

            {busy ? <InlineLoading label="Saving…" /> : 'Confirm and save'}

          </button>

        )}

        {showMccCreate ? (

          <button

            type="button"

            className="btn btn-secondary"

            disabled={busy}

            onClick={() => void saveMccCreateIntent()}

          >

            Create new Google Ads account under MCC

          </button>

        ) : null}

      </div>

    </div>

  )

}


