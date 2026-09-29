import { apiRequest } from './client'

export type LeadCampaignSlotName = 'recommended' | 'alternative'

export type AdminLeadCampaignSlot = {
  slot?: LeadCampaignSlotName
  action?: 'calls' | 'forms'
  offer?: string
  places?: string[]
  page?: string
  proofLine?: string
  reviewStatus?: string
  reservedAt?: string
}

export type AdminLeadCampaignWorkspaceResponse = {
  leadCampaignSet: {
    recommended?: AdminLeadCampaignSlot | null
    alternative?: AdminLeadCampaignSlot | null
    operatorNotifications?: Array<{
      type: string
      slot: string
      dedupeKey?: string
      policyTopic?: string
      adResourceName?: string
      createdAt?: string
    }>
  } | null
  tracking?: unknown
  sendBackReasons: string[]
}

export type AdminFactCheckBody = {
  businessName?: string
  websiteUrl?: string
  phone?: string
  email?: string
  services?: string[]
  whoBuysToday?: string
  serviceAreas?: string[]
  orderValueHint?: string
  howBuyersContact?: string
  businessCountry?: string
}

export async function adminApplyFactCheck(
  businessId: string,
  corrections: AdminFactCheckBody,
): Promise<{ businessId: string; saved: boolean }> {
  return apiRequest(`/api/v1/admin/businesses/${businessId}/fact-check`, {
    method: 'PATCH',
    body: JSON.stringify(corrections),
  })
}

export async function adminGetLeadCampaignWorkspace(
  businessId: string,
): Promise<AdminLeadCampaignWorkspaceResponse> {
  return apiRequest(`/api/v1/admin/businesses/${businessId}/lead-campaigns`, {
    method: 'GET',
  })
}

export async function adminRecordSetupCall(
  businessId: string,
  body: {
    phone?: string
    email?: string
    orderValueHint?: string
    confirmedFields?: string[]
  },
): Promise<{ businessId: string; setupCallConfirmedAt: string }> {
  return apiRequest(`/api/v1/admin/businesses/${businessId}/setup-call`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function adminStartOnboardingScrape(
  businessId: string,
): Promise<{ scrapeRunId: string; workflowId: string; status: string }> {
  return apiRequest(`/api/v1/admin/businesses/${businessId}/scrape`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function adminApproveCampaignSlot(
  businessId: string,
  slot: string,
  note?: string,
): Promise<unknown> {
  return apiRequest(`/api/v1/admin/businesses/${businessId}/lead-campaigns/${slot}/approve`, {
    method: 'POST',
    body: JSON.stringify({ note }),
  })
}

export async function adminRegenerateCampaignSlot(
  businessId: string,
  slot: string,
): Promise<unknown> {
  return apiRequest(`/api/v1/admin/businesses/${businessId}/lead-campaigns/${slot}/regenerate`, {
    method: 'POST',
    body: JSON.stringify({}),
  })
}

export async function adminSendBackCampaignSlot(
  businessId: string,
  slot: string,
  reasonCode: string,
  note?: string,
): Promise<unknown> {
  return apiRequest(`/api/v1/admin/businesses/${businessId}/lead-campaigns/${slot}/send-back`, {
    method: 'POST',
    body: JSON.stringify({ reasonCode, note }),
  })
}
