import { apiRequest } from '../../../../../frontend/src/api/client'
import { createSandboxBusiness, type SandboxBusinessResponse } from './devIntegrations'

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
  provider: 'gbp'
  businessId: string
  userId: string
  returnPath: string
  stages: OAuthLabStage[]
  firstFailure: OAuthLabStage | null
  oauthLikelyComplete: boolean
  connectUrl: string | null
}

export interface GbpReadTestResult {
  provider: 'gbp'
  businessId: string
  mode: 'read'
  locationReady: boolean
  locationName: string | null
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

export async function fetchGbpOAuthLabConnectUrl(
  businessId: string,
): Promise<{ url: string; businessId: string; returnPath: string }> {
  const q = new URLSearchParams({ businessId })
  return apiRequest(`/dev/integrations/gbp/connect-url?${q.toString()}`)
}

export async function runGbpOAuthTrace(
  businessId: string,
): Promise<{ result: OAuthTraceResult }> {
  const q = new URLSearchParams({ businessId })
  return apiRequest(`/dev/integrations/gbp/oauth-trace?${q.toString()}`)
}

export async function runGbpReadTest(
  businessId: string,
  options?: { accountName?: string; locationName?: string },
): Promise<{ result: GbpReadTestResult }> {
  return apiRequest('/dev/integrations/gbp/read-test', {
    method: 'POST',
    body: {
      businessId,
      accountName: options?.accountName,
      locationName: options?.locationName,
    },
  })
}

export { createSandboxBusiness, type SandboxBusinessResponse }
