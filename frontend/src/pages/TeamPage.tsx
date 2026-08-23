import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  acceptOrgInvite,
  createOrg,
  listOrgs,
  sendOrgInvite,
  type OrgMembershipDto,
} from '../api/orgs'
import { ApiError } from '../api/client'
import { ErrorAlert } from '../components/feedback/ErrorAlert'
import { InlineLoading } from '../components/feedback/InlineLoading'
import { PageLayout } from '../components/layout/PageLayout'

export function TeamPage(): ReactElement {
  const [searchParams, setSearchParams] = useSearchParams()
  const [orgs, setOrgs] = useState<OrgMembershipDto[]>([])
  const [selectedOrgId, setSelectedOrgId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [orgName, setOrgName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member')

  const inviteToken = searchParams.get('token')?.trim() ?? ''
  const inviteEmailParam = searchParams.get('email')?.trim() ?? ''

  const selectedOrg = useMemo(
    () => orgs.find((org) => org.id === selectedOrgId) ?? null,
    [orgs, selectedOrgId],
  )

  const refreshOrgs = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await listOrgs()
      setOrgs(res.orgs)
      if (res.orgs.length > 0) {
        setSelectedOrgId((prev) => prev && res.orgs.some((org) => org.id === prev) ? prev : res.orgs[0].id)
      } else {
        setSelectedOrgId('')
      }
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not load organizations.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshOrgs()
  }, [refreshOrgs])

  useEffect(() => {
    if (!inviteToken) return
    setBusy(true)
    setError(null)
    void acceptOrgInvite(inviteToken, inviteEmailParam || undefined)
      .then((res) => {
        setMessage(`Invite accepted for organization ${res.orgId}.`)
        setSearchParams({}, { replace: true })
        return refreshOrgs()
      })
      .catch((err) => {
        if (err instanceof ApiError) setError(err.message)
        else setError('Could not accept invite.')
      })
      .finally(() => setBusy(false))
  }, [inviteToken, inviteEmailParam, refreshOrgs, setSearchParams])

  async function onCreateOrg(): Promise<void> {
    const name = orgName.trim()
    if (!name) {
      setError('Organization name is required.')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await createOrg(name)
      setOrgName('')
      setMessage(`Organization "${res.org.name}" created.`)
      await refreshOrgs()
      setSelectedOrgId(res.org.id)
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not create organization.')
    } finally {
      setBusy(false)
    }
  }

  async function onSendInvite(): Promise<void> {
    if (!selectedOrgId) {
      setError('Select an organization first.')
      return
    }
    const email = inviteEmail.trim().toLowerCase()
    if (!email) {
      setError('Invite email is required.')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const res = await sendOrgInvite(selectedOrgId, email, inviteRole)
      setInviteEmail('')
      setMessage(res.message)
    } catch (err) {
      if (err instanceof ApiError) setError(err.message)
      else setError('Could not send invite.')
    } finally {
      setBusy(false)
    }
  }

  const canInvite = selectedOrg?.role === 'owner' || selectedOrg?.role === 'admin'

  return (
    <PageLayout title="Team" lead="Invite teammates to your organization.">
      <ErrorAlert message={error} />
      {message ? <p className="notice">{message}</p> : null}
      {loading ? (
        <InlineLoading label="Loading team…" />
      ) : orgs.length === 0 ? (
        <div className="actions" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          <p>Create an organization to invite teammates.</p>
          <label>
            Organization name
            <input
              type="text"
              value={orgName}
              onChange={(e) => setOrgName(e.target.value)}
              disabled={busy}
            />
          </label>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void onCreateOrg()}>
            Create organization
          </button>
        </div>
      ) : (
        <div className="actions" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '1rem' }}>
          <label>
            Organization
            <select
              value={selectedOrgId}
              onChange={(e) => setSelectedOrgId(e.target.value)}
              disabled={busy}
            >
              {orgs.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name} ({org.role})
                </option>
              ))}
            </select>
          </label>
          {canInvite ? (
            <>
              <label>
                Invite email
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label>
                Role
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as 'member' | 'admin')}
                  disabled={busy}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => void onSendInvite()}
              >
                Send invite
              </button>
            </>
          ) : (
            <p>You can view this organization but cannot send invites with your role.</p>
          )}
        </div>
      )}
    </PageLayout>
  )
}
