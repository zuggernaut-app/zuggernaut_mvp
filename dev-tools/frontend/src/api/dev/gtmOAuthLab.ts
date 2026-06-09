import { apiRequest } from '../../../../../frontend/src/api/client'
import {
  createSandboxBusiness,
  fetchGtmResourceOptions,
  saveGtmSelection,
  type GtmResourceOptionsResult,
  type SandboxBusinessResponse,
} from './devIntegrations'

export interface OAuthLabStage {
  id: string
  label: string
  ok: boolean
  skipped?: boolean
  detail?: string
  hint?: string
  data?: Record<string, unknown>
}

export interface OAuthTraceResult {
  provider: 'gtm'
  businessId: string
  userId: string
  returnPath: string
  stages: OAuthLabStage[]
  firstFailure: OAuthLabStage | null
  oauthLikelyComplete: boolean
  connectUrl: string | null
}

export type GtmTestMode = 'read' | 'write' | 'all'

export interface GtmReadWriteTestResult {
  provider: 'gtm'
  businessId: string
  mode: GtmTestMode
  workspaceReady: boolean
  gtmIds: { accountId: string; containerId: string; workspaceId: string } | null
  startedAt: string
  completedAt: string
  ok: boolean
  message: string
  stages: OAuthLabStage[]
  firstFailure: OAuthLabStage | null
  summary: {
    total: number
    passed: number
    failed: number
    skipped: number
  }
}

export async function fetchGtmOAuthLabConnectUrl(
  businessId: string,
): Promise<{ url: string; businessId: string; returnPath: string }> {
  const q = new URLSearchParams({ businessId })
  return apiRequest(`/dev/integrations/gtm/connect-url?${q.toString()}`)
}

export async function runGtmOAuthTrace(
  businessId: string,
): Promise<{ result: OAuthTraceResult }> {
  const q = new URLSearchParams({ businessId })
  return apiRequest(`/dev/integrations/gtm/oauth-trace?${q.toString()}`)
}

export async function runGtmReadWriteTest(
  businessId: string,
  options: {
    accountId: string
    containerId: string
    workspaceId: string
    mode?: GtmTestMode
  },
): Promise<{ result: GtmReadWriteTestResult }> {
  return apiRequest('/dev/integrations/gtm/read-write-test', {
    method: 'POST',
    body: {
      businessId,
      accountId: options.accountId,
      containerId: options.containerId,
      workspaceId: options.workspaceId,
      mode: options.mode ?? 'all',
    },
  })
}

export {
  createSandboxBusiness,
  fetchGtmResourceOptions,
  saveGtmSelection,
  type GtmResourceOptionsResult,
  type SandboxBusinessResponse,
}
