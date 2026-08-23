import { useState, type ReactElement } from 'react'
import { ApiError } from '../../api/client'
import { writeGbpLocation } from '../../api/integrations'
import { ErrorAlert } from '../feedback/ErrorAlert'

interface GbpWritePanelProps {
  businessId: string
  locationId?: string
}

export function GbpWritePanel({ businessId, locationId = 'primary' }: GbpWritePanelProps): ReactElement {
  const [consent, setConsent] = useState(false)
  const [postText, setPostText] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function onSubmitPost(): Promise<void> {
    if (!consent) {
      setError('Explicit consent is required before writing to Google Business Profile.')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await writeGbpLocation(locationId, {
        businessId,
        action: 'post',
        post: { summary: postText.trim() },
        consent: true,
      })
      setMessage(`GBP write result: ${String(res.result?.outcome ?? 'ok')}`)
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('GBP write failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h3>Google Business Profile writes</h3>
      <p>Hours and posts only. Writes require explicit consent.</p>
      <ErrorAlert message={error} />
      {message ? <p className="notice">{message}</p> : null}
      <label>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={busy}
        />
        I consent to Zuggernaut updating my Google Business Profile on my behalf.
      </label>
      <label>
        Post text
        <textarea
          value={postText}
          onChange={(e) => setPostText(e.target.value)}
          disabled={busy}
          rows={3}
        />
      </label>
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onSubmitPost()}>
        Publish GBP post
      </button>
    </section>
  )
}
