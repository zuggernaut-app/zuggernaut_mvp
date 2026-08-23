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
