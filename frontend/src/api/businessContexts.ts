import type {
  BusinessContextDto,
  BusinessContextUpdateBody,
  GetBusinessContextResponse,
  PutBusinessContextResponse,
} from '../types/api'
import { apiRequest } from './client'

export function listBusinessContexts(): Promise<{ businessContexts: BusinessContextDto[] }> {
  return apiRequest<{ businessContexts: BusinessContextDto[] }>('/business-contexts')
}

export function getBusinessContext(businessId: string): Promise<GetBusinessContextResponse> {
  return apiRequest<GetBusinessContextResponse>(`/business-contexts/${businessId}`)
}

export function updateBusinessContext(
  businessId: string,
  body: BusinessContextUpdateBody
): Promise<PutBusinessContextResponse> {
  return apiRequest<PutBusinessContextResponse>(`/business-contexts/${businessId}`, {
    method: 'PUT',
    body,
  })
}

export interface CustomerSignupDetailsBody {
  businessName: string
  hasNoWebsite?: boolean
  websiteUrl?: string
  termsAccepted: true
  businessCountry?: string
  accountCurrencyCode: string
  accountTimeZone?: string
  whatYouSell?: string
  whoBuysToday?: string
  whereTheyServe?: string
  howBuyersContact?: string
  orderValueHint?: string
}

export function completeCustomerSignupDetails(
  businessId: string,
  body: CustomerSignupDetailsBody
): Promise<PutBusinessContextResponse> {
  return apiRequest<PutBusinessContextResponse>(
    `/business-contexts/${businessId}/customer-signup-details`,
    {
      method: 'POST',
      body,
    }
  )
}
