import { useCallback, useEffect, useState, type ReactElement } from 'react'

import { ApiError } from '../../api/client'
import {
  adminApproveCampaignSlot,
  adminGetLeadCampaignWorkspace,
  adminRegenerateCampaignSlot,
  adminSendBackCampaignSlot,
  adminStartOnboardingScrape,
  type AdminLeadCampaignSlot,
  type LeadCampaignSlotName,
} from '../../api/adminLeadCampaigns'
import { ErrorAlert } from '../feedback/ErrorAlert'
import { InlineLoading } from '../feedback/InlineLoading'

interface AdminLeadCampaignReviewSectionProps {
  businessId: string
}

function formatPlaces(places: string[] | undefined): string {
  if (!Array.isArray(places) || places.length === 0) return '—'
  return places.join(', ')
}

export function AdminLeadCampaignReviewSection({
  businessId,
}: AdminLeadCampaignReviewSectionProps): ReactElement {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [sendBackReasons, setSendBackReasons] = useState<string[]>([])
  const [slots, setSlots] = useState<{
    recommended: AdminLeadCampaignSlot | null
    alternative: AdminLeadCampaignSlot | null
  }>({ recommended: null, alternative: null })
  const [notifications, setNotifications] = useState<
    Array<{
      type: string
      slot: string
      policyTopic?: string
      adResourceName?: string
      createdAt?: string
    }>
  >([])
  const [reasonBySlot, setReasonBySlot] = useState<Record<LeadCampaignSlotName, string>>({
    recommended: 'offer_not_clear',
    alternative: 'offer_not_clear',
  })
  const [noteBySlot, setNoteBySlot] = useState<Record<LeadCampaignSlotName, string>>({
    recommended: '',
    alternative: '',
  })

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await adminGetLeadCampaignWorkspace(businessId)
      setSlots({
        recommended: data.leadCampaignSet?.recommended ?? null,
        alternative: data.leadCampaignSet?.alternative ?? null,
      })
      setNotifications(data.leadCampaignSet?.operatorNotifications ?? [])
      setSendBackReasons(data.sendBackReasons ?? [])
      if (data.sendBackReasons?.[0]) {
        setReasonBySlot({
          recommended: data.sendBackReasons[0],
          alternative: data.sendBackReasons[0],
        })
      }
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not load lead campaigns.')
    } finally {
      setLoading(false)
    }
  }, [businessId])

  useEffect(() => {
    void load()
  }, [load])

  async function run(action: () => Promise<unknown>, success: string): Promise<void> {
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      await action()
      setNotice(success)
      await load()
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Action failed.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <InlineLoading label="Loading lead campaigns…" />
  }

  const slotEntries = (['recommended', 'alternative'] as LeadCampaignSlotName[])
    .map((name) => ({ name, slot: slots[name] }))
    .filter((entry) => entry.slot?.reservedAt)

  return (
    <section className="stack" style={{ marginTop: '1.5rem', gap: '1rem' }}>
      <h2>Lead campaigns</h2>
      {error ? <ErrorAlert message={error} /> : null}
      {notice ? <p role="status">{notice}</p> : null}

      <div className="cluster" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(() => adminStartOnboardingScrape(businessId), 'Onboarding scrape started.')
          }
        >
          Start onboarding scrape
        </button>
      </div>

      {notifications.length > 0 ? (
        <div className="alert alert-info">
          <strong>Disapproval alerts</strong>
          <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
            {notifications.map((row) => (
              <li key={`${row.slot}-${row.adResourceName}-${row.createdAt}`}>
                {row.slot}: {row.policyTopic ?? 'policy issue'} — send back to regenerate
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {slotEntries.length === 0 ? (
        <p style={{ color: 'var(--color-muted)' }}>No managed campaign slots yet.</p>
      ) : (
        slotEntries.map(({ name, slot }) => {
          if (!slot) return null
          return (
            <article
              key={name}
              style={{
                border: '1px solid var(--color-border, #ddd)',
                borderRadius: '8px',
                padding: '1rem',
              }}
            >
              <h3 style={{ marginTop: 0, textTransform: 'capitalize' }}>{name}</h3>
              <dl style={{ margin: '0 0 1rem', fontSize: '0.95rem' }}>
                <dt>Offer</dt>
                <dd>{slot.offer ?? '—'}</dd>
                <dt>Places</dt>
                <dd>{formatPlaces(slot.places)}</dd>
                <dt>Action</dt>
                <dd>{slot.action ?? '—'}</dd>
                <dt>Page</dt>
                <dd>{slot.page ?? '—'}</dd>
                <dt>Proof line</dt>
                <dd>{slot.proofLine ?? '—'}</dd>
                <dt>Review status</dt>
                <dd>{slot.reviewStatus ?? 'pending_review'}</dd>
              </dl>

              <div className="field" style={{ marginBottom: '0.75rem' }}>
                <label htmlFor={`send-back-reason-${name}`}>Send-back reason</label>
                <select
                  id={`send-back-reason-${name}`}
                  value={reasonBySlot[name]}
                  onChange={(e) =>
                    setReasonBySlot((prev) => ({ ...prev, [name]: e.target.value }))
                  }
                >
                  {sendBackReasons.map((code) => (
                    <option key={code} value={code}>
                      {code.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ marginBottom: '0.75rem' }}>
                <label htmlFor={`send-back-note-${name}`}>Send-back note (optional)</label>
                <input
                  id={`send-back-note-${name}`}
                  value={noteBySlot[name]}
                  onChange={(e) =>
                    setNoteBySlot((prev) => ({ ...prev, [name]: e.target.value }))
                  }
                />
              </div>

              <div className="cluster" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => adminApproveCampaignSlot(businessId, name),
                      `${name} campaign approved.`,
                    )
                  }
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        adminSendBackCampaignSlot(
                          businessId,
                          name,
                          reasonBySlot[name],
                          noteBySlot[name] || undefined,
                        ),
                      `${name} campaign sent back.`,
                    )
                  }
                >
                  Send back
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => adminRegenerateCampaignSlot(businessId, name),
                      `${name} ad regenerated.`,
                    )
                  }
                >
                  Regenerate ad
                </button>
              </div>
            </article>
          )
        })
      )}
    </section>
  )
}
