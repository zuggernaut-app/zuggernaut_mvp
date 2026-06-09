import { apiRequest } from './client'
import {
  createSandboxBusiness,
  fetchGoogleAdsResourceOptions,
  saveGoogleAdsSelection,
  type GoogleAdsResourceOptionsResult,
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
  provider: 'google_ads'
  businessId: string
  userId: string
  returnPath: string
  stages: OAuthLabStage[]
  firstFailure: OAuthLabStage | null
  oauthLikelyComplete: boolean
  connectUrl: string | null
}

export interface MccLinkResult {
  provider: 'google_ads'
  businessId: string
  startedAt: string
  completedAt: string
  ok: boolean
  linkReady: boolean
  message: string
  managerCustomerId: string | null
  clientCustomerId: string | null
  linkStatus: {
    status: string | null
    managerLinkId: string | null
    resourceName: string | null
  } | null
  stages: OAuthLabStage[]
  firstFailure: OAuthLabStage | null
  summary: {
    total: number
    passed: number
    failed: number
    skipped: number
  }
}

export type ReadWriteTestMode = 'read' | 'write' | 'all'

export interface ReadWriteTestResult {
  provider: 'google_ads'
  businessId: string
  mode: ReadWriteTestMode
  linkReady: boolean
  customerId: string | null
  managerCustomerId: string | null
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

export async function fetchGoogleAdsOAuthLabConnectUrl(
  businessId: string,
): Promise<{ url: string; businessId: string; returnPath: string }> {
  const q = new URLSearchParams({ businessId })
  return apiRequest(`/dev/integrations/googleads/connect-url?${q.toString()}`)
}

export async function runGoogleAdsOAuthTrace(
  businessId: string,
): Promise<{ result: OAuthTraceResult }> {
  const q = new URLSearchParams({ businessId })
  return apiRequest(`/dev/integrations/googleads/oauth-trace?${q.toString()}`)
}

export async function runGoogleAdsMccLink(
  businessId: string,
  options: {
    managerCustomerId: string
    clientCustomerId: string
    sendInvitation?: boolean
    acceptLink?: boolean
  },
): Promise<{ result: MccLinkResult }> {
  return apiRequest('/dev/integrations/googleads/mcc-link', {
    method: 'POST',
    body: {
      businessId,
      managerCustomerId: options.managerCustomerId,
      clientCustomerId: options.clientCustomerId,
      sendInvitation: options.sendInvitation === true,
      acceptLink: options.acceptLink === true,
    },
  })
}

export async function runGoogleAdsReadWriteTest(
  businessId: string,
  options?: {
    customerId?: string
    managerCustomerId?: string
    includeCampaign?: boolean
    mode?: ReadWriteTestMode
  },
): Promise<{ result: ReadWriteTestResult }> {
  return apiRequest('/dev/integrations/googleads/read-write-test', {
    method: 'POST',
    body: {
      businessId,
      customerId: options?.customerId,
      managerCustomerId: options?.managerCustomerId,
      includeCampaign: options?.includeCampaign === true,
      mode: options?.mode ?? 'all',
    },
  })
}

export {
  createSandboxBusiness,
  fetchGoogleAdsResourceOptions,
  saveGoogleAdsSelection,
  type GoogleAdsResourceOptionsResult,
  type SandboxBusinessResponse,
}
