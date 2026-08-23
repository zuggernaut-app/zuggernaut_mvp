import { apiRequest } from './client'

export interface AdsCampaignState {
  campaignResourceName: string
  status: string
  budgetResourceName: string | null
  amountMicros: number | null
  setupRunId: string
  source: string
}

export interface AdsCampaignMutationResponse {
  outcome: string
  status?: string
  amountMicros?: number
  action?: Record<string, unknown>
}

export function getAdsCampaign(businessId: string): Promise<{ campaign: AdsCampaignState }> {
  const params = new URLSearchParams({ businessId })
  return apiRequest<{ campaign: AdsCampaignState }>(
    `/integrations/google_ads/campaign?${params.toString()}`,
    { method: 'GET' },
  )
}

export function enableAdsCampaign(businessId: string): Promise<AdsCampaignMutationResponse> {
  return apiRequest<AdsCampaignMutationResponse>('/integrations/google_ads/campaign/enable', {
    method: 'POST',
    body: { businessId },
  })
}

export function pauseAdsCampaign(businessId: string): Promise<AdsCampaignMutationResponse> {
  return apiRequest<AdsCampaignMutationResponse>('/integrations/google_ads/campaign/pause', {
    method: 'POST',
    body: { businessId },
  })
}

export function updateAdsCampaignBudget(
  businessId: string,
  amountMicros: number,
): Promise<AdsCampaignMutationResponse> {
  return apiRequest<AdsCampaignMutationResponse>('/integrations/google_ads/campaign/budget', {
    method: 'PATCH',
    body: { businessId, amountMicros },
  })
}
