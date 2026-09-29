import { apiRequest } from './client'

export type CampaignPerformanceMetrics = {
  impressions: number
  clicks: number
  costMicros: number
  conversions: number
  dateRangeDays: number
}

export type SlotPerformanceEntry = {
  campaignResourceName: string
  metrics: CampaignPerformanceMetrics
  source: string
} | null

export type CampaignPerformanceResponse = {
  performance: {
    businessId: string
    slots?: {
      recommended: SlotPerformanceEntry
      alternative: SlotPerformanceEntry
    }
    campaignResourceName?: string
    metrics?: CampaignPerformanceMetrics
    source?: string
  }
}

export async function getAdsCampaignPerformance(businessId: string): Promise<CampaignPerformanceResponse> {
  return apiRequest<CampaignPerformanceResponse>(
    `/integrations/google_ads/campaign/performance?businessId=${encodeURIComponent(businessId)}`,
  )
}
