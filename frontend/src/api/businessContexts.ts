import type {
  BusinessContextUpdateBody,
  GetBusinessContextResponse,
  PutBusinessContextResponse,
} from '../types/api'
import { apiRequest } from './client'

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
