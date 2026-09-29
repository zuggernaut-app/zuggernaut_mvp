import { apiRequest } from './client'

export type LeadCampaignSlotName = 'recommended' | 'alternative'

export type LeadCampaignSlotState = {
  slot: LeadCampaignSlotName
  action?: 'calls' | 'forms'
  offer?: string
  places?: string[]
  page?: string
  proofLine?: string
  reviewStatus?: string
  committedBudgetMicros?: number
  budgetConfirmedAt?: string | null
  liveStatus?: string | null
  amountMicros?: number | null
  blocked?: {
    owner: 'customer' | 'operator'
    customerMessage: 'waiting_on_you' | 'working_on_it'
    title: string
  } | null
}

export type LeadCampaignDashboardResponse = {
  businessId: string
  currency?: string
  budgetFloorMicros?: number
  budgetCeilingMicros?: number
  subscriptionActive?: boolean
  slots: {
    recommended: LeadCampaignSlotState | null
    alternative: LeadCampaignSlotState | null
  }
}

export function getLeadCampaignDashboard(
  businessId: string,
): Promise<LeadCampaignDashboardResponse> {
  const params = new URLSearchParams({ businessId })
  return apiRequest<LeadCampaignDashboardResponse>(
    `/integrations/google_ads/lead-campaigns?${params.toString()}`,
    { method: 'GET' },
  )
}

export function enableLeadCampaignSlot(
  businessId: string,
  slot: LeadCampaignSlotName,
): Promise<{ outcome: string; status?: string; slot: string }> {
  return apiRequest(`/integrations/google_ads/lead-campaigns/${slot}/enable`, {
    method: 'POST',
    body: { businessId },
  })
}

export function pauseLeadCampaignSlot(
  businessId: string,
  slot: LeadCampaignSlotName,
): Promise<{ outcome: string; status?: string; slot: string }> {
  return apiRequest(`/integrations/google_ads/lead-campaigns/${slot}/pause`, {
    method: 'POST',
    body: { businessId },
  })
}

export function confirmLeadCampaignBudget(
  businessId: string,
  slot: LeadCampaignSlotName,
  amountMicros: number,
): Promise<{ outcome: string; slot: string; budgetConfirmedAt?: string }> {
  return apiRequest(`/integrations/google_ads/lead-campaigns/${slot}/confirm-budget`, {
    method: 'POST',
    body: { businessId, amountMicros },
  })
}
