import type { ScrapeResponse } from '../types/api'
import { apiRequest } from './client'

export function createBusinessDraft(): Promise<{ businessId: string }> {
  return apiRequest('/onboarding/business', {
    method: 'POST',
    body: {},
  })
}

export function scrapeBusiness(
  businessId: string,
  websiteUrl: string
): Promise<ScrapeResponse> {
  return apiRequest<ScrapeResponse>(`/onboarding/business/${businessId}/scrape`, {
    method: 'POST',
    body: { websiteUrl },
  })
}
