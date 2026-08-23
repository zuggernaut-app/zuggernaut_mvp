import { useEffect, useState, type ReactElement } from 'react'
import { ApiError } from '../../api/client'
import {
  fetchGtmAccounts,
  fetchGtmResourceOptions,
  saveGtmAccountSelection,
  saveGtmSelection,
} from '../../api/integrations'
import { ErrorAlert } from '../feedback/ErrorAlert'
import { InlineLoading } from '../feedback/InlineLoading'

interface GtmResourceSelectorProps {
  businessId: string
  onSaved: () => void
  mode?: 'default' | 'create-new'
}

export function GtmResourceSelector({
  businessId,
  onSaved,
  mode = 'default',
}: GtmResourceSelectorProps): ReactElement {
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [accountId, setAccountId] = useState('')
  const [containerId, setContainerId] = useState('')
  const [workspaceId, setWorkspaceId] = useState('')
  const [accounts, setAccounts] = useState<
    Awaited<ReturnType<typeof fetchGtmResourceOptions>>['result']['accounts']
  >([])
  const [accountOnlyOptions, setAccountOnlyOptions] = useState<
    Awaited<ReturnType<typeof fetchGtmAccounts>>['result']['accounts']
  >([])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void (async () => {
      try {
        if (mode === 'create-new') {
          const { result } = await fetchGtmAccounts(businessId)
          if (cancelled) return
          if (result.accounts.length === 0) {
            setError(
              'No GTM account was found for this Google user. Create one at https://tagmanager.google.com, then click Refresh connections.',
            )
            setAccountOnlyOptions([])
            return
          }
          setAccountOnlyOptions(result.accounts)
          if (result.selectedAccountId) {
            setAccountId(result.selectedAccountId)
          } else {
            setAccountId('')
          }
          return
        }

        const { result } = await fetchGtmResourceOptions(businessId)
        if (cancelled) return
        if (result.reason === 'GTM_ACCOUNT_NOT_FOUND') {
          setError(
            'No GTM account was found for this Google user. Create one at https://tagmanager.google.com, then click Refresh connections.',
          )
          setAccounts([])
          return
        }
        if (result.reason === 'GTM_PROVISIONING_REQUIRED') {
          setError(
            'No usable GTM container or workspace was found. Provisioning approval is required instead.',
          )
          setAccounts([])
          return
        }
        setAccounts(result.accounts)
        if (result.selected) {
          setAccountId(result.selected.accountId)
          setContainerId(result.selected.containerId)
          setWorkspaceId(result.selected.workspaceId)
        } else {
          const account = result.accounts[0]
          const container = account?.containers[0]
          const workspace = container?.workspaces[0]
          if (account && container && workspace) {
            setAccountId(account.accountId)
            setContainerId(container.containerId)
            setWorkspaceId(workspace.workspaceId)
          }
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Could not load GTM resources.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [businessId, mode])

  const selectedAccount = accounts.find((a) => a.accountId === accountId)
  const selectedContainer = selectedAccount?.containers.find((c) => c.containerId === containerId)

  async function saveSelection(): Promise<void> {
    if (mode === 'create-new') {
      if (!accountId) return
      setBusy(true)
      setError(null)
      try {
        await saveGtmAccountSelection({ businessId, accountId })
        onSaved()
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not save GTM account selection.')
      } finally {
        setBusy(false)
      }
      return
    }

    if (!accountId || !containerId || !workspaceId) return
    setBusy(true)
    setError(null)
    try {
      await saveGtmSelection({ businessId, accountId, containerId, workspaceId })
      onSaved()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save GTM selection.')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return <InlineLoading label="Loading GTM resources…" />
  }

  if (mode === 'create-new') {
    return (
      <div className="form" style={{ marginTop: '0.75rem' }}>
        <ErrorAlert message={error} />
        <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', marginBottom: '0.75rem' }}>
          Select a GTM account. Zuggernaut will create a new container during setup.
        </p>
        <div className="field">
          <label htmlFor="gtmAccount">GTM account</label>
          <select
            id="gtmAccount"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">Select an account…</option>
            {accountOnlyOptions.map((account) => (
              <option key={account.accountId} value={account.accountId}>
                {account.name ?? account.accountId}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={busy || !accountId}
          onClick={() => void saveSelection()}
        >
          {busy ? <InlineLoading label="Saving…" /> : 'Save GTM account'}
        </button>
      </div>
    )
  }

  return (
    <div className="form" style={{ marginTop: '0.75rem' }}>
      <ErrorAlert message={error} />
      <div className="field">
        <label htmlFor="gtmAccount">GTM account</label>
        <select
          id="gtmAccount"
          value={accountId}
          onChange={(e) => {
            const nextAccount = accounts.find((a) => a.accountId === e.target.value)
            const nextContainer = nextAccount?.containers[0]
            const nextWorkspace = nextContainer?.workspaces[0]
            setAccountId(e.target.value)
            setContainerId(nextContainer?.containerId ?? '')
            setWorkspaceId(nextWorkspace?.workspaceId ?? '')
          }}
        >
          {accounts.map((account) => (
            <option key={account.accountId} value={account.accountId}>
              {account.name ?? account.accountId}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="gtmContainer">Container</label>
        <select
          id="gtmContainer"
          value={containerId}
          onChange={(e) => {
            const nextContainer = selectedAccount?.containers.find(
              (c) => c.containerId === e.target.value,
            )
            const nextWorkspace = nextContainer?.workspaces[0]
            setContainerId(e.target.value)
            setWorkspaceId(nextWorkspace?.workspaceId ?? '')
          }}
        >
          {(selectedAccount?.containers ?? []).map((container) => (
            <option key={container.containerId} value={container.containerId}>
              {container.name ?? container.containerId}
              {container.publicContainerId ? ` (${container.publicContainerId})` : ''}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="gtmWorkspace">Workspace</label>
        <select
          id="gtmWorkspace"
          value={workspaceId}
          onChange={(e) => setWorkspaceId(e.target.value)}
        >
          {(selectedContainer?.workspaces ?? []).map((workspace) => (
            <option key={workspace.workspaceId} value={workspace.workspaceId}>
              {workspace.name ?? workspace.workspaceId}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={busy || !workspaceId}
        onClick={() => void saveSelection()}
      >
        {busy ? <InlineLoading label="Saving…" /> : 'Save GTM selection'}
      </button>
    </div>
  )
}
