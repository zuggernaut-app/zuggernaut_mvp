import { apiRequest } from './client'

export type SnippetCheckResult = {
  status: 'on_site' | 'not_on_site' | 'error'
  message?: string
  code?: string
  publicContainerId?: string
}

export type TrackingGoalStatus = 'pass' | 'not_fired' | 'no_conversion_action'

export type TrackingTestPollResponse = {
  goals: Record<string, TrackingGoalStatus>
  trackingTestStartedAt: string
}

export function checkBusinessSetupSnippet(businessId: string): Promise<SnippetCheckResult> {
  return apiRequest<SnippetCheckResult>('/business-setup/check-snippet', {
    method: 'POST',
    body: { businessId },
  })
}

export function startBusinessSetupTrackingTest(
  businessId: string,
): Promise<{ trackingTestStartedAt: string }> {
  return apiRequest('/business-setup/tracking-test/start', {
    method: 'POST',
    body: { businessId },
  })
}

export function pollBusinessSetupTrackingTest(
  businessId: string,
): Promise<TrackingTestPollResponse> {
  const params = new URLSearchParams({ businessId })
  return apiRequest<TrackingTestPollResponse>(
    `/business-setup/tracking-test/result?${params.toString()}`,
    { method: 'GET' },
  )
}

export function skipBusinessSetupGbp(businessId: string): Promise<{ skipped: boolean }> {
  return apiRequest('/business-setup/gbp-skip', {
    method: 'POST',
    body: { businessId },
  })
}

export function confirmBusinessSetupFacts(
  businessId: string,
  body: Record<string, unknown>,
): Promise<{ businessId: string; factCheckCompletedAt: string | null; saved: boolean }> {
  return apiRequest('/business-setup/fact-confirm', {
    method: 'PATCH',
    body: { businessId, ...body },
  })
}
